import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import config from '@cocreate/config';
import { requireBootstrapStorage } from '../src/server/bootstrap.js';
import { createRepositoryCredential, githubKnownHosts } from '../src/server/repository-credential.js';
import { resolveOrganizationsConfig, defaults } from '../src/server/config.js';
import { init } from '../src/server/index.js';

test('bootstrap validation preserves provider-specific fields without imposing a connection-string schema', () => {
    const bootstrap = { name: 'primary', provider: 'custom', endpoint: 'https://storage.test', credentials: { reference: 'stored-secret' } };
    assert.equal(requireBootstrapStorage(bootstrap), bootstrap);
    for (const invalid of [null, [], {}, { name: 'primary' }, { name: '', provider: 'custom' }]) {
        assert.throws(() => requireBootstrapStorage(invalid), /name and provider/);
    }
});

test('signup deploy key is a matching RSA SSH key pair with no scheduled expiration', async () => {
    const credential = await createRepositoryCredential('credential-id');
    assert.equal(credential.enabled, false);
    assert.equal(credential.status, 'pending');
    assert.equal(credential.authentication, 'ssh-deploy-key');
    assert.equal(credential.expires_at, undefined);
    const jwk = createPublicKey(createPrivateKey(credential.privateKey)).export({ format: 'jwk' });
    const packet = Buffer.from(credential.publicKey.split(' ')[1], 'base64');
    let offset = 0;
    const readString = () => {
        const length = packet.readUInt32BE(offset);
        offset += 4;
        const value = packet.subarray(offset, offset + length);
        offset += length;
        return value;
    };
    const unsigned = buffer => (buffer[0] === 0 ? buffer.subarray(1) : buffer).toString('base64url');
    assert.equal(readString().toString(), 'ssh-rsa');
    assert.equal(unsigned(readString()), jwk.e);
    assert.equal(unsigned(readString()), jwk.n);
    assert.equal(offset, packet.length);
});

test('GitHub host verification accepts only explicit SSH public keys', () => {
    assert.equal(githubKnownHosts(['ssh-ed25519 AAAA', 'ssh-rsa BBBB']), 'github.com ssh-ed25519 AAAA\ngithub.com ssh-rsa BBBB\n');
    for (const invalid of [[], undefined, ['github.com ssh-rsa AAAA'], ['ssh-rsa AAAA\nattacker.test ssh-rsa BBBB']]) {
        assert.throws(() => githubKnownHosts(invalid), /host keys/);
    }
});

test('workflow configuration is isolated between server instances and contains no local Git lifecycle options', async t => {
    t.mock.method(config, 'get', () => undefined);
    t.mock.method(config, 'query', async () => undefined);
    const server = { organization_id: 'platform', crud: {} };
    const customized = await resolveOrganizationsConfig(server, {
        clusterProvisioning: { scaleIn: { minClusterSize: 1 } },
        repositoryProvisioning: { api: 'custom-github' }, databaseProvisioning: { regionName: 'region-one' }
    });
    assert.equal(customized.repositoryProvisioning.api, 'custom-github');
    const clean = await resolveOrganizationsConfig(server);
    assert.equal(clean.repositoryProvisioning.api, defaults.repositoryProvisioning.api);
    assert.equal(defaults.repositoryProvisioning.api, 'github-organizations');
    assert.deepEqual(clean.databaseProvisioning, {});
    assert.equal(clean.clusterProvisioning.scaleIn.minClusterSize, 0);
    assert.equal(customized.clusterProvisioning.scaleIn.minClusterSize, 1);
    for (const obsolete of ['localFsRoot', 'gitBinary', 'uploadBinary', 'templateUrl']) assert.equal(Object.hasOwn(clean, obsolete), false);
});

test('an empty CRUD error list is treated as an empty lookup, without provisioning side effects', async t => {
    t.mock.method(config, 'get', () => undefined);
    t.mock.method(config, 'query', async () => undefined);
    const requests = [];
    let response;
    const service = await init({
        organization_id: 'platform',
        crud: { send: async request => {
            requests.push(request);
            return { object: [], error: [] };
        } },
        send: value => { response = value; },
        wsManager: { on() {}, send() { assert.fail("Component must use server.send"); } }
    });
    await service.create({
        organization_id: 'source',
        user_id: 'user',
        host: 'source.test',
        socketId: 'socket-1',
        clientId: 'client-1',
        socket: { organization_id: 'forged', user_id: 'forged', host: 'forged.test' },
        organization: { host: [{ name: 'tenant.test' }] }
    });
    assert.equal(response.success, false);
    assert.equal(response.message, "Unable to resolve the signed-in user's credential");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'object.read');
});
