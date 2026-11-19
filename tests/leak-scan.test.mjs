// Tests for scripts/leak-scan.mjs's key rules (security@'s ruling, Website 1acd10498, 19 Nov 2026).
// live.b@PrompTugal.dinis. Every key-shaped string is built from parts at run time, so this file does not match itself.
import { scanText } from '../scripts/leak-scan.mjs';

let failed = 0;
const kinds = (path, text) => scanText(path, text).map((f) => f.kind);
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed++; };

const D = '-'.repeat(5);
const header = (t) => `${D}BEGIN ${t}PRIVATE KEY${D}`;
const body = 'A'.repeat(4) + 'C3Nz' + 'aC1l' + 'q'.repeat(40); // key-shaped, not a real key
const sshPub = (alg) => `${alg} ${body} someone@example`;

// 1. Every private key header fails, in every file, with no exemption (the allow list included).
for (const t of ['OPENSSH ', 'RSA ', 'EC ', 'DSA ', 'ENCRYPTED ', ''])
  for (const path of ['README.md', 'team/keys.json', '_site/keys.json', 'src/assets/obs/obs.json'])
    check(`${t || 'PKCS#8 '}private key header fails in ${path}`, kinds(path, header(t)).includes('private key block'));

// 2. An SSH public key outside its published field is flagged by shape, even where the entropy rule is allowed.
for (const alg of ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com'])
  check(`${alg} public key flagged in a status file`, kinds('board/team/live/status.json', `"note": "${sshPub(alg)}"`).includes('SSH public key outside its published field'));
check('SSH public key flagged in obs.json, whose entropy findings are allowed', kinds('src/assets/obs/obs.json', sshPub('ssh-ed25519')).includes('SSH public key outside its published field'));

// 3. Plain text naming the algorithms is not a key.
check('the word ssh-ed25519 alone is not flagged', !kinds('README.md', 'We sign with ssh-ed25519 keys.').includes('SSH public key outside its published field'));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('OK');
