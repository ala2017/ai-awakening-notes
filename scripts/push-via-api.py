#!/usr/bin/env python3
"""当 github.com:443 被阻断、git push 走不通时，用 GitHub 的 Git Data API 推送。

做的是与 `git push` 完全相同的事：把本地若干个提交对应的树与提交对象建到远端，
再更新 refs/heads/main。只是换了通道——api.github.com 通而 github.com 不通时，
这是唯一能走的路。

只上传本次提交里改动的文件（新增/修改建 blob，删除在树里置 sha=null），
`base_tree` 指向远端当前树，其余文件不动。

用法：  python3 scripts/push-via-api.py [--dry-run]
token 从 origin 的 URL 里读，不硬编码。
"""
import base64, json, os, re, subprocess, sys, urllib.request, urllib.error

API = 'https://api.github.com'
DRY = '--dry-run' in sys.argv


def sh(*args, binary=False):
    # core.quotepath=false：否则 git 会把非 ASCII 路径转义成 \346\234\200 形式，
    # 拿去 open() 必然失败。本仓库绝大多数路径是中文。
    r = subprocess.run(['git', '-c', 'core.quotepath=false', *args], capture_output=True)
    if r.returncode:
        raise SystemExit('❌ %s -> %s' % (' '.join(args), r.stderr.decode()[:200]))
    return r.stdout if binary else r.stdout.decode().strip()


def token_repo():
    url = sh('remote', 'get-url', 'origin')
    m = re.match(r'https://(?:([^:@/]+)(?::([^@/]+))?@)?github\.com/(.+?)(?:\.git)?$', url)
    if not m:
        raise SystemExit('❌ 无法从 origin 解析仓库地址：%s' % url)
    return (m.group(2) or m.group(1)), m.group(3)


def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        API + path, method=method, data=body,
        headers={'Authorization': 'Bearer %s' % TOKEN,
                 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'ai-awakening-notes-push'})
    if body:
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit('❌ %s %s -> %d %s' % (method, path, e.code, e.read().decode()[:300]))


if sh('status', '--porcelain'):
    raise SystemExit('❌ 工作区有未提交改动，先提交再推送：\n' + sh('status', '--porcelain'))

TOKEN, REPO = token_repo()
LOCAL = sh('rev-parse', 'HEAD')

# 远端当前提交不取自本地 origin/main，而是直接问 API。
# 理由：用 API 推过之后，本地没有那个新提交对象，origin/main 会停在旧值上——
# 再推一次就会以旧提交为父，non-fast-forward 失败。
base_ref = api('GET', '/repos/%s/git/ref/heads/main' % REPO)
BASE = base_ref['object']['sha']
base_commit = api('GET', '/repos/%s/git/commits/%s' % (REPO, BASE))

# 变更清单改为「本地树 vs 远端树」比对，同样不依赖本地引用是否同步。
local_tree_sha = sh('rev-parse', 'HEAD^{tree}')
remote_tree = api('GET', '/repos/%s/git/trees/%s?recursive=1' % (REPO, base_commit['tree']['sha']))
remote_files = {e['path']: (e['mode'], e['sha']) for e in remote_tree['tree'] if e['type'] == 'blob'}
local_files = {}
for line in sh('ls-tree', '-r', 'HEAD').split('\n'):
    if not line.strip():
        continue
    meta, path = line.split('\t', 1)
    mode, _type, sha = meta.split()
    local_files[path] = (mode, sha)
entries = sorted(p for p in local_files if remote_files.get(p) != local_files[p])
dels = sorted(p for p in remote_files if p not in local_files)
if not entries and not dels:
    print('远端已是最新，无需推送'); sys.exit(0)
# 提交信息取本地 HEAD 的。不回溯源到 BASE——BASE 是 API 侧的对象，本地没有。
message = sh('log', '--pretty=%B', '-1', LOCAL)


print('本地 %s  远端 %s' % (LOCAL[:8], BASE[:8]))
print('新增/修改 %d 个，删除 %d 个' % (len(entries), len(dels)))
if DRY:
    for e in entries: print('   + %s' % e)
    for d in dels: print('   - %s' % d)
    sys.exit(0)

# 逐个建 blob
tree_items = []
for i, path in enumerate(entries, 1):
    # 从提交对象里取内容，不从工作区取：工作区若脏，推上去的东西
    # 会和提交记录的树不一致（这个坑在本次真实发生过一次）
    data = subprocess.run(['git', 'cat-file', 'blob', 'HEAD:%s' % path],
                          capture_output=True).stdout
    blob = api('POST', '/repos/%s/git/blobs' % REPO,
               {'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
    mode = sh('ls-files', '-s', '--', path).split()[0] if sh('ls-files', '-s', '--', path) else '100644'
    tree_items.append({'path': path, 'mode': mode, 'type': 'blob', 'sha': blob['sha']})
    print('  [%2d/%2d] %s  %.1f KB' % (i, len(entries), path[-52:], len(data) / 1024))
for path in dels:
    tree_items.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})

tree = api('POST', '/repos/%s/git/trees' % REPO,
           {'base_tree': base_commit['tree']['sha'], 'tree': tree_items})
commit = api('POST', '/repos/%s/git/commits' % REPO,
             {'message': message, 'tree': tree['sha'], 'parents': [BASE]})
api('PATCH', '/repos/%s/git/refs/heads/main' % REPO, {'sha': commit['sha'], 'force': False})
print('\n✅ 已推送  %s -> %s' % (BASE[:8], commit['sha'][:8]))
