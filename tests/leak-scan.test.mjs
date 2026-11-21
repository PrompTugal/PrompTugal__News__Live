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

// 4. GitHub's web-flow key (security@'s ruling 8667c27ce): one file, exactly one armored public key block whose packets
// are only public ones. OpenPGP packets are made at run time (a new-format header 0xC0 | tag, a one-byte length, a body),
// so this file holds no key-shaped literal. Tag 6 is a public key, 13 a user ID, 5 a secret key.
{ const pgp = (kind) => [`${D}BEGIN PGP ${kind} KEY BLOCK${D}`, `${D}END PGP ${kind} KEY BLOCK${D}`];
  const pkt = (tag, n) => Buffer.concat([Buffer.from([0xc0 | tag, n]), tag === 13 ? Buffer.from('x'.repeat(n)) : Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + tag * 11) % 256))]);
  const arm = (buf) => buf.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n?$/, '\n');
  const b64 = arm(Buffer.concat([pkt(6, 120), pkt(13, 20)])) + '=ezfm\n';
  const b64secret = arm(Buffer.concat([pkt(5, 120), pkt(13, 20)])) + '=ezfm\n';
  const [pb, pe] = pgp('PUBLIC'), [vb, ve] = pgp('PRIVATE');
  const good = `${pb}\n\n${b64}${pe}\n`;
  const F = 'team/github-web-flow.asc', BAD = 'web-flow key file is not exactly one public key block';
  check('the web-flow key file passes when it is exactly one public key block', kinds(F, good).length === 0);
  check('a private key block in the web-flow key file fails, never allowed', kinds(F, `${vb}\n\n${b64}${ve}\n`).includes('private key block'));
  check('a secret-key packet under a PUBLIC header fails (the packets are decoded)', kinds(F, `${pb}\n\n${b64secret}${pe}\n`).includes(BAD));
  check('a public key block in any other file fails', kinds('team/other.asc', good).includes('public key outside team/keys'));
  check('trailing text after the block fails', kinds(F, good + 'and a note\n').includes(BAD));
  check('text before the block fails', kinds(F, 'note\n' + good).includes(BAD));
  check('two public key blocks fail', kinds(F, good + good).includes(BAD));
  check('CRLF line ends fail', kinds(F, good.replace(/\n/g, '\r\n')).includes(BAD));
  check('an armour header line (Comment:) fails', kinds(F, good.replace(`${pb}\n`, `${pb}\nComment: a note\n`)).includes(BAD));
  check('a private key header hidden inside the block fails', kinds(F, good.replace('\n=ezfm', `\n${vb}\n=ezfm`)).length > 0);
  check('a file over the size cap fails', kinds(F, `${pb}\n\n${arm(Buffer.concat([pkt(6, 120), ...Array.from({ length: 400 }, () => pkt(13, 120))]))}${pe}\n`).includes(BAD));
  check('padding in the middle of the body fails (nothing hides after a stray =)', kinds(F, `${pb}\n\n${arm(pkt(6, 3))}${arm(Buffer.concat([pkt(13, 20), pkt(13, 20)]))}${pe}\n`).includes(BAD));
  check('a first packet that is not a public key fails', kinds(F, `${pb}\n\n${arm(Buffer.concat([pkt(13, 20), pkt(6, 120)]))}${pe}\n`).includes(BAD));
  check('a user ID that is not printable text fails', kinds(F, `${pb}\n\n${arm(Buffer.concat([pkt(6, 120), Buffer.from([0xcd, 3, 0, 1, 2])]))}${pe}\n`).includes(BAD));
  // a public key packet of 1280 bytes, with a five-byte new-format length (0xff, then 4 bytes), over the 1100 cap
  check('an oversized key packet fails', kinds(F, `${pb}\n\n${arm(Buffer.concat([Buffer.from([0xc6, 0xff, 0, 0, 0x05, 0x00]), Buffer.alloc(1280, 7)]))}${pe}\n`).includes(BAD));
  check('a key-shaped block elsewhere still fails', kinds('README.md', good).includes('public key outside team/keys')); }

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('OK');
