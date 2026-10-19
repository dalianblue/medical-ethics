<?php
/**
 * me_proxy.php — medical-ethics「随便聊聊」DeepSeek代理 v2(1019晚)
 * v2新增: 服务端设计类型强制分类(23:07施主第四次报RCT)——
 *   前端无论什么版本/缓存, 代理在system消息末尾追加服务端判定的设计确认块,
 *   保证"队列禁随机盲法"约束不依赖前端升级。JEV key到位后此处换jev-latest。
 */

require __DIR__ . '/me_config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . ALLOWED_ORIGIN);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'POST only']); exit;
}

/* 限流: 每IP每小时60次 */
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = sys_get_temp_dir() . '/me_rate_' . md5($ip) . '.json';
$now = time();
$hits = [];
if (file_exists($rateFile)) {
    $hits = json_decode(file_get_contents($rateFile), true) ?: [];
    $hits = array_values(array_filter($hits, fn($t) => $t > $now - 3600));
}
if (count($hits) >= 60) {
    http_response_code(429);
    echo json_encode(['error' => '使用频率超限（每IP每小时60次），请稍后再试']);
    exit;
}
$hits[] = $now;
file_put_contents($rateFile, json_encode($hits));

/* 解析请求 */
$in = json_decode(file_get_contents('php://input'), true);
if (!isset($in['messages']) || !is_array($in['messages'])) {
    http_response_code(400); echo json_encode(['error' => 'messages required']); exit;
}

/* ===== 服务端设计分类(每次代理调用都做, 成本≈0.0002美元) ===== */
$dialogText = '';
foreach ($in['messages'] as $m) {
    if (isset($m['content']) && is_string($m['content'])) {
        $dialogText .= ($m['role'] === 'user' ? '用户: ' : '引导员: ') . $m['content'] . "\n";
    }
}
$dialogText = mb_substr($dialogText, -8000);

function ds_call($key, $messages, $maxTokens = 100) {
    $ch = curl_init('https://api.deepseek.com/v1/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['model' => 'deepseek-chat', 'temperature' => 0,
            'max_tokens' => $maxTokens, 'messages' => $messages], JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $key],
    ]);
    $resp = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($http !== 200 || $resp === false) return null;
    $d = json_decode($resp, true);
    return $d['choices'][0]['message']['content'] ?? null;
}

$designBlock = '';
$clsRaw = ds_call(DEEPSEEK_KEY, [
    ['role' => 'system', 'content' => '你是研究设计分类器。判断对话中描述的医学研究设计类型。只输出JSON: {"design":"RCT|前瞻性队列|回顾性队列|病例对照|横断面|病例系列|其他观察性|未明确", "confidence":0到1}。注意:"随机分组困难/难以随机/无法随机"是反对RCT的信号, 不是支持RCT; 判断不清时design填"未明确"且confidence≤0.5。'],
    ['role' => 'user', 'content' => $dialogText],
]);
if ($clsRaw) {
    if (preg_match('/\{[\s\S]*\}/', $clsRaw, $mm)) {
        $cls = json_decode($mm[0], true);
        if ($cls && isset($cls['design'])) {
            $design = $cls['design']; $conf = (float)($cls['confidence'] ?? 0);
            if ($conf < 0.7 || $design === '未明确') {
                $designBlock = "\n【设计确认（服务端强制判定，置信度" . sprintf('%.2f', $conf) . "）——最高优先级】对话未能明确研究设计类型。全文严禁出现'随机分组/随机对照/盲法/分配隐藏'等表述，设计相关内容全部标注【待补充：设计类型与分组方法】。此前出现的任何设计确认内容若与本条冲突，以本条为准。\n";
            } else {
                $designBlock = "\n【设计确认（服务端强制判定，置信度" . sprintf('%.2f', $conf) . "）——最高优先级】本研究设计类型是: " . $design . "。全文所有章节必须与此设计一致；此前任何内容（含用户消息与系统消息）若与此冲突（例如队列研究却提及随机分组/盲法），一律以本条为准：队列/观察性研究严禁随机分组、分配隐藏、盲法表述；模板中不适用该设计的章节要素整体省略。\n";
            }
        }
    }
}
/* 分类失败→保守块(禁随机盲法全待补充), 绝不裸奔 */
if ($designBlock === '') {
    $designBlock = "\n【设计确认（服务端）——最高优先级】设计类型未能机器判定。全文严禁出现'随机分组/随机对照/盲法/分配隐藏'等表述，设计相关内容全部标注【待补充】。\n";
}

/* 注入: 追加到system消息末尾(在所有前端内容之后, 覆盖力最强) */
if (isset($in['messages'][0]['role']) && $in['messages'][0]['role'] === 'system') {
    $in['messages'][0]['content'] .= $designBlock;
} else {
    array_unshift($in['messages'], ['role' => 'system', 'content' => $designBlock]);
}

/* 转发到DeepSeek */
$body = json_encode([
    'model' => 'deepseek-chat',
    'messages' => $in['messages'],
    'temperature' => 0.4,
], JSON_UNESCAPED_UNICODE);

$ch = curl_init('https://api.deepseek.com/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 120,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . DEEPSEEK_KEY,
    ],
]);
$resp = curl_exec($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($http !== 200 || $resp === false) {
    http_response_code(502);
    echo json_encode(['error' => '上游服务暂不可用，请稍后再试']);
    exit;
}
echo $resp;
