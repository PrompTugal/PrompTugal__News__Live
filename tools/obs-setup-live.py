#!/usr/bin/env python3
"""Make live.promptugal.news's own observability lane (live.b@PrompTugal.dinis, 18 November 2026, at Dinis Cruz's word in this session: "yes, allow assets/obs/obs.json in the leak scan"; and his guidance of 18 Nov ~14:55 UTC in
PrompTugal__News__Website board/guidance/2026-11-18-keys-issues-rebuilds-observability.md: each site lead creates its own lane
and append tokens and shares the drain credentials with conductor.b@ sealed to conductor.b@'s key).

The model is PrompTugal__News__Website's newsroom/tools/obs/obs_setup.py, smaller:

    SG_SEND_ACCESS_TOKEN=... python3 -I tools/obs-setup-live.py --conductor <conductor.b's public bundle JSON>

1. a PRIVATE data vault (promptugal-obs-live) on dev.send.sgraph.ai with a README, the drain key (an RSA-4096 pair made
   here; only its public half leaves the vault) and identity/lanes.json; four append lanes named 'live 1..4' configured on it;
2. writes the public half to src/assets/obs/obs.json (endpoint, vault id, the lanes' append tokens, the drain's public key:
   public on purpose, a token can only append to its lane and the key can only encrypt);
3. keeps the credentials (vault key, enum key, tokens) in ~/.sg-send/obs-live/creds.json (0600), outside the repository;
4. seals them to conductor.b@'s key with `sgit pki encrypt` into ~/.sg-send/obs-live/sealed-for-conductor.b (ciphertext only;
   not committed: it is handed to conductor.b@ directly).
Run once. Prints no credential.
"""
import argparse, datetime, hashlib, json, os, secrets, subprocess, sys, tempfile, urllib.request

sys.dont_write_bytecode = True
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST = 'https://dev.send.sgraph.ai'
AGENT = 'live.b@PrompTugal.dinis'
DIR = os.path.expanduser('~/.sg-send/obs-live')
CREDS = os.path.join(DIR, 'creds.json')
VAULTS = os.path.expanduser('~/vaults')
h = lambda s: hashlib.sha256(s.encode()).hexdigest()

def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'Content-Type': 'application/json', **headers})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read() or b'{}')

def sgit(cwd, *a, env=None):
    r = subprocess.run(['sgit', *a], cwd=cwd, capture_output=True, text=True, env=env)
    if r.returncode: sys.exit(f'obs-setup-live: sgit {a[0]} failed (exit {r.returncode}): ' + (r.stderr or r.stdout).strip().splitlines()[-1][:200])
    return r.stdout

def wjson(p, obj, mode=None):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    # a secret file is created at its mode, never written first and narrowed after (live.b@'s post-review, 18 Nov 2026)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode or 0o644)
    with os.fdopen(fd, 'w') as f: f.write(json.dumps(obj, indent=2, ensure_ascii=False) + '\n')
    if mode: os.chmod(p, mode)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--conductor', required=True, help="conductor.b-promptugal's public bundle (JSON file)")
    o = ap.parse_args()
    if os.path.exists(CREDS): sys.exit(f'obs-setup-live: {CREDS} exists; the lane is made already')
    token = os.environ['SG_SEND_ACCESS_TOKEN']
    from sgit_ai.crypto.PKI__Crypto import PKI__Crypto
    from sgit_ai.crypto.Vault__Crypto import Vault__Crypto
    pki, today = PKI__Crypto(), datetime.datetime.now(datetime.timezone.utc).strftime('%-d %B %Y')
    os.makedirs(DIR, mode=0o700, exist_ok=True); os.makedirs(VAULTS, mode=0o700, exist_ok=True); os.chmod(VAULTS, 0o700)

    # 1. the private data vault, with the drain key inside it
    name = 'promptugal-obs-live'; d = os.path.join(VAULTS, name)
    if os.path.exists(d): sys.exit(f'obs-setup-live: {d} exists; this runs once')
    sgit(VAULTS, 'create', name, '--base-url', HOST, '--token', token, '--no-push')
    open(os.path.join(d, 'README.md'), 'w').write(f"# live.promptugal.news observability: the data vault (private)\n\nMade by {AGENT} on {today}, at Dinis Cruz's word, with tools/obs-setup-live.py in PrompTugal/PrompTugal__News__Live. Page views and reads from live.promptugal.news (assets/obs/obs.js, lane 'live') arrive sealed to the drain key (identity/) on this vault's append lanes. The drain is conductor.b@PrompTugal.dinis's, with the credentials sealed to it. Private.\n")
    priv, pub = pki.generate_encryption_key_pair()
    pub_pem, priv_pem = pki.export_public_key_pem(pub), pki.export_private_key_pem(priv)
    fp = pki.compute_fingerprint(pub)
    os.makedirs(os.path.join(d, 'identity', 'private'), exist_ok=True)
    fd = os.open(os.path.join(d, 'identity', 'private', 'private_key.pem'), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(priv_pem)
    wjson(os.path.join(d, 'identity', 'public-bundle.json'), {'encrypt': pub_pem, 'fingerprint': fp, 'label': 'live.promptugal.news observability drain'})
    names = ['live 1', 'live 2', 'live 3', 'live 4']
    toks = [secrets.token_hex(32) for _ in names]
    wjson(os.path.join(d, 'identity', 'lanes.json'), {'about': 'The append lanes, in order, by the SHA-256 of each token (the anchor the server holds).',
                                                      'lanes': [{'name': n, 'anchor': h(t)} for n, t in zip(names, toks)]})
    sgit(d, 'commit', 'the live data vault: README, the drain key, the lanes'); sgit(d, 'push')
    vk = open(os.path.join(d, '.sg_vault', 'local', 'vault_key')).read().strip(); vid = vk.split(':')[-1]
    enum_key = secrets.token_hex(32)
    write_key = Vault__Crypto().derive_keys_from_vault_key(vk)['write_key']
    r = post(f'{HOST}/api/vault/append/configure/{vid}', {'append_anchors': [h(t) for t in toks], 'enum_key_hash': h(enum_key)},
             {'x-sgraph-vault-write-key': write_key, 'x-sgraph-access-token': token})
    if r.get('status') != 'configured': sys.exit(f'obs-setup-live: configure answered {r.get("status")}')

    # 2. the public half, in this repository
    p = os.path.join(ROOT, 'src', 'assets', 'obs', 'obs.json')
    cfg = json.load(open(p))
    cfg.update({'about': f"live.promptugal.news's page views and reads, sent by assets/obs/obs.js into live's own observability vault, made by {AGENT} on {today} at Dinis Cruz's word (tools/obs-setup-live.py). Public on purpose: each append token can only append to its lane, and the key can only encrypt. The drain is conductor.b@PrompTugal.dinis's (credentials sealed to its key). The geo lookup list is read from promptugal.news's obs.json (config_from).",
                'enabled': True, 'lane': 'live', 'endpoint': HOST, 'vault_id': vid, 'lanes': {'live': toks},
                'recipient': {'fingerprint': fp, 'encrypt': pub_pem}})
    wjson(p, cfg)

    # 3. the credentials, outside the repository
    creds = {'type': 'promptugal.obs/creds', 'site': 'live.promptugal.news', 'lane': 'live', 'host': HOST, 'vault_id': vid, 'vault_key': vk,
             'enum_key': enum_key, 'tokens': toks, 'lane_names': names, 'drain_key_fingerprint': fp, 'made': today, 'by': AGENT,
             'drain_key_in': 'the data vault, identity/private/private_key.pem'}
    wjson(CREDS, creds, 0o600)

    # 4. sealed to conductor.b@
    imp = subprocess.run(['sgit', 'pki', 'import', o.conductor], capture_output=True, text=True)
    out = subprocess.run(['sgit', 'pki', 'contacts'], capture_output=True, text=True).stdout
    cfp = json.load(open(o.conductor)).get('fingerprint')
    if not cfp or cfp not in out: sys.exit(f'obs-setup-live: could not import conductor.b@\'s key ({(imp.stderr or imp.stdout).strip()[:200]})')
    sealed = os.path.join(DIR, 'sealed-for-conductor.b')
    me = os.environ.get('LIVE_KEY_FP')  # sign the envelope with live.b-promptugal when its passphrase is in SG_SEND_PASSPHRASE
    r = subprocess.run(['sgit', 'pki', 'encrypt', CREDS, '--recipient', cfp, '--output', sealed, *(['--fingerprint', me] if me else [])], capture_output=True, text=True)
    if r.returncode: sys.exit('obs-setup-live: sealing failed: ' + (r.stderr or r.stdout).strip()[:300])
    print(f'obs-setup-live: data vault {vid} (private, 4 live lanes configured); drain key {fp}; src/assets/obs/obs.json written; '
          f'credentials in {CREDS}; sealed to conductor.b@ ({cfp}) in {sealed}')

if __name__ == '__main__': main()
