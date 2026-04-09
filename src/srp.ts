// Custom SRP-6a implementation matching MitID's protocol
// Ported from https://github.com/Hundter/MitID-BrowserClient
import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";

// The 4096-bit safe prime used by MitID
const N =
  4983313092069490398852700692508795473567251422586244806694940877242664573189903192937797446992068818099986958054998012331720869136296780936009508700487789962429161515853541556719593346959929531150706457338429058926505817847524855862259333438239756474464759974189984231409170758360686392625635632084395639143229889862041528635906990913087245817959460948345336333086784608823084788906689865566621015175424691535711520273786261989851360868669067101108956159530739641990220546209432953829448997561743719584980402874346226230488627145977608389858706391858138200618631385210304429902847702141587470513336905449351327122086464725143970313054358650488241167131544692349123381333204515637608656643608393788598011108539679620836313915590459891513992208387515629240292926570894321165482608544030173975452781623791805196546326996790536207359143527182077625412731080411108775183565594553871817639221414953634530830290393130518228654795859n;
const g = 2n;

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function sha256hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function bigintToBytes(x: bigint): Buffer {
  const hex = x.toString(16);
  const padded = hex.length % 2 ? "0" + hex : hex;
  return Buffer.from(padded, "hex");
}

function bytesToBigint(buf: Buffer): bigint {
  return BigInt("0x" + buf.toString("hex"));
}

function bytesToHex(buf: Buffer): string {
  return buf.toString("hex");
}

// Modular exponentiation for BigInt
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  base = ((base % mod) + mod) % mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

// PKCS7 padding (operates on strings, matching Python implementation)
function pad(s: string): string {
  const BLOCK_SIZE = 16;
  const padLen = BLOCK_SIZE - (s.length % BLOCK_SIZE);
  return s + String.fromCharCode(padLen).repeat(padLen);
}

export class CustomSRP {
  private a!: bigint;
  private A!: bigint;
  private B!: bigint;
  private hashedPassword!: bigint;
  private m1Hex!: string;
  kBits!: Buffer;

  srpStage1(): string {
    const aBytes = randomBytes(32);
    this.a = bytesToBigint(aBytes);
    this.A = modPow(g, this.a, N);
    return this.A.toString(16);
  }

  private computeLittleS(): bigint {
    const nBytes = bigintToBytes(N);
    let gBytes = bigintToBytes(g);
    // Pad g_bytes to same length as N_bytes
    gBytes = Buffer.concat([Buffer.alloc(nBytes.length - gBytes.length), gBytes]);

    // DEVIATION: N is hashed as its decimal string representation
    const hash = sha256(Buffer.concat([Buffer.from(N.toString(10), "utf-8"), gBytes]));
    return BigInt("0x" + hash.toString("hex"));
  }

  private computeU(): bigint {
    const nLen = bigintToBytes(N).length;
    let aBytes = bigintToBytes(this.A);
    let bBytes = bigintToBytes(this.B);

    // Pad to N length
    aBytes = Buffer.concat([Buffer.alloc(nLen - aBytes.length), aBytes]);
    bBytes = Buffer.concat([Buffer.alloc(nLen - bBytes.length), bBytes]);

    const hash = sha256(Buffer.concat([aBytes, bBytes]));
    return BigInt("0x" + hash.toString("hex")) % N;
  }

  private computeSessionKey(): bigint {
    const u = this.computeU();
    const s = this.computeLittleS();

    const exp = u * this.hashedPassword + this.a;
    const base = ((this.B - modPow(g, this.hashedPassword, N) * s) % N + N) % N;
    return modPow(base, exp, N);
  }

  private computeM1(iHex: string, srpSalt: string): string {
    // DEVIATION: N and g hashed as decimal strings
    const hN = BigInt("0x" + sha256hex(Buffer.from(N.toString(10), "utf-8")));
    const hG = BigInt("0x" + sha256hex(Buffer.from(g.toString(10), "utf-8")));
    const xor = hN ^ hG;

    // DEVIATION: all big integers serialized as decimal strings
    const msg =
      xor.toString(10) +
      iHex +
      srpSalt +
      this.A.toString(10) +
      this.B.toString(10) +
      bytesToHex(this.kBits);
    return sha256hex(Buffer.from(msg, "ascii"));
  }

  srpStage3(
    srpSalt: string,
    randomB: string,
    password: string,
    authSessionId: string,
  ): string {
    this.B = BigInt("0x" + randomB);

    if (this.B === 0n || this.B % N === 0n) {
      throw new Error("randomB did not pass safety check");
    }

    // Hash password: SHA256(srpSalt + password) as ASCII hex strings
    this.hashedPassword = BigInt(
      "0x" + sha256hex(Buffer.from(srpSalt + password, "ascii")),
    );

    // Compute session key S, then K_bits = SHA256(str(S))
    const sessionKey = this.computeSessionKey();
    // DEVIATION: S is hashed as its decimal string representation
    this.kBits = sha256(Buffer.from(sessionKey.toString(10), "utf-8"));

    // Compute I = SHA256(authSessionId)
    const iHex = sha256hex(Buffer.from(authSessionId, "utf-8"));

    this.m1Hex = this.computeM1(iHex, srpSalt);
    return this.m1Hex;
  }

  srpStage5(m2Hex: string): boolean {
    const m1BigInt = BigInt("0x" + this.m1Hex);
    const msg =
      this.A.toString(10) + m1BigInt.toString(10) + bytesToHex(this.kBits);
    const m2Verify = sha256hex(Buffer.from(msg, "utf-8"));
    return m2Verify === m2Hex;
  }

  authEnc(plaintext: Buffer): Buffer {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-gcm", this.kBits, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, encrypted, tag]);
  }

  authDec(encMessageB64: string): Buffer {
    const buf = Buffer.from(encMessageB64, "base64");
    const iv = buf.subarray(0, 16);
    const ciphertext = buf.subarray(16, buf.length - 16);
    const tag = buf.subarray(buf.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.kBits, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function createFlowValueProof(
  kBits: Buffer,
  keyPrefix: string,
  proofData: Buffer,
): string {
  const keyInput = keyPrefix + bytesToHex(kBits);
  const key = sha256(Buffer.from(keyInput, "utf-8"));
  return createHmac("sha256", key).update(proofData).digest("hex");
}

export { pad, bytesToHex };
