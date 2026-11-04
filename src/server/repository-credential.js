import { generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

const generate = promisify(generateKeyPair);
const sshString = value => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
};

/** Generate only locally; the private key never enters the GitHub request/workflow. */
export async function createRepositoryCredential(id) {
    const { publicKey, privateKey } = await generate('rsa', { modulusLength: 3072 });
    const jwk = publicKey.export({ format: 'jwk' });
    const mpint = value => {
        const buffer = Buffer.from(value, 'base64url');
        return sshString(buffer[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buffer]) : buffer);
    };
    const publicSsh = `ssh-rsa ${Buffer.concat([sshString(Buffer.from('ssh-rsa')), mpint(jwk.e), mpint(jwk.n)]).toString('base64')}`;
    return {
        _id: id, name: 'github-repository', provider: 'github', authentication: 'ssh-deploy-key',
        enabled: false, status: 'pending', publicKey: publicSsh,
        privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' })
    };
}

export function githubKnownHosts(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,2}$/.test(key))) {
        throw new Error('GitHub SSH host keys were not returned.');
    }
    return keys.map(key => `github.com ${key}`).join('\n') + '\n';
}
