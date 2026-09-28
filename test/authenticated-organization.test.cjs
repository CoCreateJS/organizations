const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const code = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default init;', '');
async function run(options = {}) {
    let handler, response, nextId = 0;
    const reads = [], writes = [];
    const credential = { type: 'user', key: 'real-user', array: options.array || 'contacts', password: 'existing-password', email: 'real@example.com' };
    const profile = { _id: 'real-user', name: 'Real User', password: 'legacy', $database: ['source'] };
    const server = {
        isInitialized: true,
        organization_id: 'platform',
        wsManager: { on: (name, fn) => { if(name === 'createOrganization') handler = fn; }, send: data => { response = data; } },
        crud: {
            send: async request => {
                if(request.method === 'object.read') {
                    reads.push(request);
                    if(options.readError) return { error: 'failed' };
                    if(request.array === 'organizations') return { object: options.duplicate ? [{ _id: 'taken' }] : [] };
                    return { object: options.missing ? [] : [request.array === 'keys' ? credential : profile] };
                }
                writes.push(request);
                if(options.failWrite === writes.length) return { error: 'write failed' };
                return { object: Array.isArray(request.object) ? request.object : [request.object] };
            }
        }
    };
    vm.runInNewContext(code, { server, ObjectId: () => `new-${++nextId}`, uuid: () => `key-${++nextId}` });
    await handler({
        socket: options.anonymous ? { organization_id: 'source' } : { user_id: 'real-user', organization_id: 'source', host: 'source.example.com', expires: options.expired ? 1 : Date.now()+60000 },
        organization_id: 'spoof', user_id: 'spoof', user: { _id: 'spoof' }, key: [{ admin: true }],
        organization: options.organization || { _id: 'existing-tenant', name: 'Team', host: [{ name: 'team.example.com', database: 'victim' }], bootstrapStorage: { url: 'attacker' }, storage: { provider: 'mongodb', url: 'tenant-url' }, description: 'Custom description', $database: ['untrusted'] },
        uuid: 'correlation'
    });
    return { response, reads, writes, credential, profile };
}
for(const array of ['contacts', 'users', 'members']) {
 test(`copies authenticated identity into ${array}`, async () => {
    const { response, reads, writes, profile, credential } = await run({array});
    assert.equal(response.success,true);
    assert.equal(reads[0].organization_id,'source');
    assert.equal(reads[0].host,'source.example.com');
    assert.equal(reads[0].filter.query.key,'real-user');
    assert.equal(reads[1].array,array);
    assert.equal(writes.length,4);
    assert.equal(writes[2].array,array);
    assert.equal(writes[2].object._id,'real-user');
    assert.equal(writes[2].object.password,undefined);
    assert.equal(writes[2].object.$database,undefined);
    assert.equal(profile.password,'legacy');
    assert.equal(credential.array,array);
    const generatedKeys = writes[3].object;
    assert.equal(generatedKeys.length, 3);
    assert.equal(generatedKeys.some(key => key.type === 'key' && key.admin), false);
    const defaultKey = generatedKeys.find(key => key.type === 'key' && key.default);
    assert.equal(defaultKey.name, 'Default');
    assert.deepEqual(JSON.parse(JSON.stringify(defaultKey.hosts)), ['*']);
    assert.deepEqual(JSON.parse(JSON.stringify(defaultKey.actions)), {
        signIn: true, signUp: true, checkSession: true, forgotPassword: true,
        resetPassword: true, acceptInvite: true, updateUserStatus: true, isUnique: true
    });
    assert.equal(generatedKeys.find(key => key.type === 'role').admin, true);
    const key=writes[3].object.find(key=>key.type==='user');
    assert.equal(key.password,'existing-password');
    assert.equal(key.array,array);
    assert.equal(key.key,'real-user');
    assert.equal(key.name,'Real User');
    assert.equal(writes[1].database,response.organization._id);
    for (const write of writes) assert.equal(write.organization_id, 'platform');
    for (const write of writes.slice(1)) assert.equal(write.database, response.organization._id);
    assert.notEqual(writes[0].database,'existing-tenant');
    assert.equal(writes[0].object.host[0].database,'victim');
    assert.equal(writes[0].object.storage.url,'tenant-url');
    assert.equal(writes[0].object.description,'Custom description');
    assert.equal(writes[0].object.$database,undefined);
    assert.equal(writes[0].object.bootstrapStorage,undefined);
    assert.equal(writes[3].object.bootstrapStorage,undefined);
    assert.equal(writes[0].database,'platform');
    assert.equal(response.organization_id,'source');
    assert.equal(response.uuid,'correlation');
    assert.equal(response.key,undefined);
    assert.equal(response.organization.bootstrapStorage,undefined);
    assert.equal(response.user,undefined);
 });
}
for(const option of ['anonymous','expired','readError','missing','duplicate']) {
 test(`rejects ${option} without provisioning`,async()=>{
    const {response,writes}=await run({[option]:true});
    assert.equal(response.success,false);assert.equal(writes.length,0);
 });
}
test('stops at the first failed write',async()=>{
 const {response,writes}=await run({failWrite:2});
 assert.equal(response.success,false);assert.equal(writes.length,2);
 assert.equal(writes[0].database,'platform');
});

for (const path of ['host[0].name', 'host.0.name']) {
 test(`accepts flat ${path} and preserves it for CRUD`, async () => {
    const {response, reads, writes} = await run({organization:{name:'Team', [path]:'team.example.com'}});
    assert.equal(response.success, true);
    assert.equal(reads[2].filter.query['host.name'], 'team.example.com');
    assert.equal(writes[0].object[path], 'team.example.com');
    assert.equal(response.organization.host[0].name, 'team.example.com');
 });
 test(`rejects invalid flat ${path} before writes`, async () => {
    const {response,writes} = await run({organization:{name:'Team', [path]:'invalid host'}});
    assert.equal(response.success, false);
    assert.equal(writes.length, 0);
 });
}

for (const name of [undefined, '', '   ']) {
 test(`defaults missing or blank organization name: ${JSON.stringify(name)}`, async () => {
    const {response,writes} = await run({organization:{name, 'host[0].name':'team.example.com'}});
    assert.equal(response.success, true);
    assert.equal(response.organization.name, 'Untitled');
    assert.equal(writes[0].object.name, 'Untitled');
    assert.equal(writes[1].object.name, 'Untitled');
 });
}
test('missing name and host reports only the host error', async () => {
    const {response,writes} = await run({organization:{}});
    assert.equal(response.message, 'A valid host is required');
    assert.equal(writes.length, 0);
});
