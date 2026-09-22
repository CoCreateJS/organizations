const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default { generateDB, create, get };', '');

async function run(name, response, options = {}) {
    const actions = [];
    const notices = [];
    let ended = 0, aborted = 0, sent = 0;
    vm.runInNewContext(source, {
        Action: { init: action => actions.push(action) },
        render: notice => notices.push(notice),
        uuid: () => 'key',
        btoa: value => value,
        Elements: { getData: async () => options.noOrganization ? [] : [
            { array: 'organizations', object: [{ _id: 'org', host: [{ name: 'team.example.com' }] }] },
            { array: 'users', object: [{ _id: 'user', email: 'user@example.com', password: 'secret' }] }
        ] },
        Crud: {
            ObjectId: () => 'id',
            send: async data => options.readFailure ? { error: 'read failed' } : data,
            socket: { organization: true, send: async request => {
                if (name === "createOrganization") {
                    assert.deepEqual(Object.keys(request).sort(), ["broadcastClient", "method", "organization"]);
                    assert.equal(request.organization._id, "org");
                }
                sent++;
                if (options.reject) throw new Error('Connection failed');
                return response;
            } }
        }
    });
    const registered = actions.find(action => action.name === name);
    assert.equal(registered.endEvent, name === 'createOrganization' ? 'createdOrganization' : 'createdEnvironments');
    await registered.callback({
        name,
        form: options.noForm ? null : { querySelector: () => ({ value: 'example.com' }) },
        abort: () => aborted++,
        end: detail => { ended++; assert.equal(detail, response); assert.equal(notices.length, 1); }
    });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].selector, '[template~="notification"]');
    return { ended, aborted, sent, notice: notices[0].data[0] };
}
for (const name of ['createOrganization', 'createEnvironments']) {
    test(`${name} ends on success with the response`, async () => {
        const result = await run(name, { success: true, message: 'Created' });
        assert.equal(result.ended, 1); assert.equal(result.aborted, 0);
        assert.equal(result.notice.message, 'Created');
    });
    for (const response of [{ success: false, message: 'Failed' }, { error: 'Denied' }, undefined]) {
        test(`${name} aborts unsuccessful or missing responses`, async () => {
            const result = await run(name, response);
            assert.equal(result.ended, 0); assert.equal(result.aborted, 1);
            assert.equal(result.notice.success, false);
        });
    }
    for (const options of [{ reject: true }, { noForm: true }]) {
        test(`${name} aborts exceptions`, async () => {
            const result = await run(name, {}, options);
            assert.equal(result.ended, 0); assert.equal(result.aborted, 1);
        });
    }
}
test('missing organization details do not send a creation request', async () => {
    const result = await run('createOrganization', {}, { noOrganization: true });
    assert.equal(result.aborted, 1); assert.equal(result.sent, 0);
});
