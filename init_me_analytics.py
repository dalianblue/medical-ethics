#!/usr/bin/env python3
"""init_me_analytics.py — 建medical-ethics对话记录库(1022施主令: 记录保存助改善)"""
import sqlite3, subprocess

db = sqlite3.connect('/www/wwwroot/default/app/me_analytics.db')
c = db.cursor()
c.execute('''CREATE TABLE IF NOT EXISTS chat_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ip_hash TEXT NOT NULL,
    design TEXT,
    confidence REAL,
    rounds INTEGER,
    total_len INTEGER,
    upstream_model TEXT,
    upstream_http INTEGER,
    latency_ms INTEGER,
    messages TEXT
)''')
c.execute('CREATE INDEX IF NOT EXISTS idx_ts ON chat_logs(ts)')
db.commit()
print('表结构:', [r[1] for r in c.execute('PRAGMA table_info(chat_logs)')])
db.close()
r = subprocess.run(['chown', 'www:www', '/www/wwwroot/default/app/me_analytics.db'],
                   capture_output=True, text=True)
print('chown www:www:', r.returncode)
