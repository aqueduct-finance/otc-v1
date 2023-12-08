import crypto from 'crypto';

function generateSalt(): bigint {
    const randomBytes = crypto.randomBytes(32); // 32 bytes = 256 bits
    return BigInt('0x' + randomBytes.toString('hex'));
}

export default generateSalt;