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

/* ===== 1025施主令: 预置API禁用, 用户自配key(存本地浏览器, 无泄露风险) =====
 * 恢复方法: 删除下面 if 块即可(proxy逻辑原样保留) */
if (true) {
    http_response_code(403);
    echo json_encode(['error' => 'PLATFORM_KEY_DISABLED',
                      'message' => '平台预置通道已停用。请在首页⚙填写你自己的 DeepSeek API Key（仅保存在你浏览器本地）。样本量设计器无需 Key，全功能可用。'], JSON_UNESCAPED_UNICODE);
    exit;
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405); echo json_encode(['error' => 'POST only']); exit;
}

/* 限流: 每IP每天25次(1022施主令: 自然日窗口, 超限引导换用户自己的Key)
   一份完整伦理材料11-17次调用(引导8-10+分类2-4+生成1-3), 25次=从容完成1.5份/迭代充裕 */
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = __DIR__ . '/ratelimit/me_rate_' . md5($ip) . '.json';  /* 持久目录(1022: /tmp会被tmpfiles清理, 计数丢失无法对账) */
$now = time();
/* 自然日窗口锚定北京时间(服务器UTC也不漂移, 1022审查建议) */
$tz = new DateTimeZone('Asia/Shanghai');
$today = (new DateTime('today midnight', $tz))->getTimestamp();
/* 原子读改写: flock防php-fpm多worker并发丢计数/写坏JSON(1022审查修复1) */
$fh = fopen($rateFile, 'c+');
if (!$fh) { $fh = tmpfile(); }   /* 极端情况(/tmp满)降级: 本次放行不计 */
if ($fh && !flock($fh, LOCK_EX)) { fclose($fh); $fh = tmpfile(); flock($fh, LOCK_EX); }  /* flock失败(1022复审): 降级tmpfile, 绝不无锁裸跑 */
if ($fh) {
    /* flock已在上面完成 */
    $raw = stream_get_contents($fh);
    $hits = json_decode($raw, true);
    $hits = is_array($hits) ? array_values(array_filter($hits, fn($t) => $t >= $today)) : [];
    if (count($hits) >= 25) {
        flock($fh, LOCK_UN); fclose($fh);
        http_response_code(429);
        echo json_encode([
            'error' => '今日免费额度已用完（每IP每天25次）。可在首页⚙填入你自己的 DeepSeek API Key 继续使用（不限量）；样本量设计器无需 Key，全功能可用。明日自动重置。'
        ]);
        exit;
    }
    $hits[] = $now;
    ftruncate($fh, 0); rewind($fh);
    fwrite($fh, json_encode($hits));
    fflush($fh);
    flock($fh, LOCK_UN); fclose($fh);
}

/* 解析请求 */
$in = json_decode(file_get_contents('php://input'), true);
if (!isset($in['messages']) || !is_array($in['messages'])) {
    http_response_code(400); echo json_encode(['error' => 'messages required']); exit;
}
/* payload上限: 防超大文本烧上游token(60KB约3万汉字, 正常使用远低于此) */
$totalLen = 0;
foreach ($in['messages'] as $m) {
    if (isset($m['content']) && is_string($m['content'])) $totalLen += strlen($m['content']);
}
if ($totalLen > 60000) {
    http_response_code(413);
    echo json_encode(['error' => '对话内容过长，请开启新对话后重试']);
    exit;
}

/* ===== 服务端设计分类(有实质内容时才做; 生成文书必然经过这里) ===== */
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
if ($clsRaw && $totalLen > 400) {
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

/* ===== 使用记录(1022施主令: 保存到服务器助后期改善) =====
   隐私: IP只存md5(ip+SALT)脱敏hash; 对话全文存本地SQLite(不外传), README有声明 */
function log_usage($design, $conf, $http, $latencyMs, $answer = null, $stage = null) {
    global $logRowId;   /* 供answer精确UPDATE(1022审查修复2: 消灭MAX(id)竞态) */
    try {
        $db = new PDO('sqlite:' . __DIR__ . '/me_analytics.db');
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec('PRAGMA journal_mode=WAL'); $db->exec('PRAGMA busy_timeout=5000');
        $ipHash = md5(($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|me2026salt');
        $rounds = 0; $totalLen = 0;
        global $in;
        foreach (($in['messages'] ?? []) as $m) {
            if (!is_array($m)) continue;
            if (($m['role'] ?? '') === 'user') $rounds++;
            if (isset($m['content']) && is_string($m['content'])) $totalLen += mb_strlen($m['content']);
        }
        $st = $db->prepare('INSERT INTO chat_logs (ts, ip_hash, design, confidence, rounds, total_len, upstream_model, upstream_http, latency_ms, messages, answer, stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
        $st->execute([time(), $ipHash, $design, $conf, $rounds, $totalLen,
                      'deepseek-chat', $http, $latencyMs,
                      json_encode($in['messages'] ?? [], JSON_UNESCAPED_UNICODE),
                      $answer, $stage]);
        $logRowId = (int)$db->lastInsertId();
    } catch (Throwable $e) { /* Throwable含TypeError(1022审查修复4); 记录失败不影响主流程 */ }
}

/* 转发到DeepSeek */
$body = json_encode([
    'model' => 'deepseek-chat',
    'messages' => $in['messages'],
    'temperature' => 0.4,
], JSON_UNESCAPED_UNICODE);

$tStart = microtime(true);
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
$latencyMs = (int)((microtime(true) - $tStart) * 1000);

/* 使用记录(成功失败都记, 助改善) */
$_designFinal = '';
if (preg_match('/设计类型是:\s*([^。]+)/u', $designBlock, $dm)) $_designFinal = trim($dm[1]);
elseif (strpos($designBlock, '未能明确') !== false || strpos($designBlock, '未能机器判定') !== false) $_designFinal = '未明确';
$_stage = 'chat';
if (isset($in['messages'][0]['content']) && preg_match('/当前阶段：[^（]*（([a-z]+)）/u', $in['messages'][0]['content'], $sm)) $_stage = $sm[1];
log_usage($_designFinal, null, $http, $latencyMs, null, $_stage);

if ($http !== 200 || $resp === false) {
    http_response_code(502);
    echo json_encode(['error' => '上游服务暂不可用，请稍后再试']);
    exit;
}
/* 补写AI回答(含生成的研究方案/知情同意书全文)
   1022审查修复2: lastInsertId精确行, 消灭MAX(id)并发串号 */
try {
    $_ans = json_decode($resp, true);
    $_ansText = $_ans['choices'][0]['message']['content'] ?? null;
    if ($_ansText && isset($logRowId) && $logRowId > 0) {
        $_db2 = new PDO('sqlite:' . __DIR__ . '/me_analytics.db');
        $_db2->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $_db2->exec('PRAGMA busy_timeout=5000');
        $_db2->prepare('UPDATE chat_logs SET answer = ? WHERE id = ?')->execute([$_ansText, $logRowId]);
    }
} catch (Throwable $e) { /* 不影响主流程 */ }
echo $resp;
