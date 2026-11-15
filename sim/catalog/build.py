#!/usr/bin/env python3
"""Builds the simulated catalogs Thinker reads with THINKER_SIM_CATALOG_URLS.

Usage: build.py <out_dir> <wwz_opencode_base>   (e.g. http://127.0.0.1:18210)

- models-dev.json: sim/catalog/models-dev.json (OpenAI, the wwz prices) plus
  the opencode and opencode-go providers, converted from the wwz catalogs to
  the models.dev v1 shape (cost per million).
- openrouter.json: copied as is.
- opencode.json: the models.dev v2 document OpenCode's client reads
  (models.opencode.ai), built from the wwz /inference[/go]/v1/models records,
  which have the same shape.
"""
import json
import os
import sys
import urllib.request

here = os.path.dirname(os.path.abspath(__file__))
out, base = sys.argv[1], sys.argv[2].rstrip('/')
os.makedirs(out, exist_ok=True)


def fetch(path):
    with urllib.request.urlopen(base + path, timeout=10) as res:
        return json.load(res)['data']


providers = {'opencode': fetch('/inference/v1/models'), 'opencode-go': fetch('/inference/go/v1/models')}

v2 = {pid: {'id': pid, 'name': pid, 'models': {m['id']: m for m in models}} for pid, models in providers.items()}
with open(os.path.join(out, 'opencode.json'), 'w') as f:
    json.dump(v2, f)

with open(os.path.join(here, 'models-dev.json')) as f:
    v1 = json.load(f)
for pid, models in providers.items():
    entries = {}
    for m in models:
        text = (m.get('cost') or {}).get('text') or {}
        cost = {
            'input': (text.get('input') or {}).get('price', 0),
            'output': (text.get('output') or {}).get('price', 0),
        }
        cache = (text.get('input') or {}).get('cache') or {}
        if 'read' in cache:
            cost['cache_read'] = cache['read']
        if 'write' in cache:
            cost['cache_write'] = cache['write']
        caps = m.get('capabilities') or {}
        entries[m['id']] = {
            'id': m['id'],
            'name': m.get('name') or m['id'],
            'reasoning': bool((caps.get('reasoning') or {}).get('supported')),
            'tool_call': (caps.get('tools') or {}).get('supported', True) is not False,
            'modalities': m.get('modalities') or {'input': ['text'], 'output': ['text']},
            'cost': cost,
            'limit': {k: v for k, v in (m.get('limit') or {}).items() if k in ('context', 'output')},
        }
    v1[pid] = {'id': pid, 'name': pid, 'models': entries}
with open(os.path.join(out, 'models-dev.json'), 'w') as f:
    json.dump(v1, f)

with open(os.path.join(here, 'openrouter.json')) as f, open(os.path.join(out, 'openrouter.json'), 'w') as g:
    g.write(f.read())
print(f"catalogs in {out}: opencode {len(providers['opencode'])}, opencode-go {len(providers['opencode-go'])}")
