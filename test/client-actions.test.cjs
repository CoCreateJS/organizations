const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sourceFiles = {
    createOrganization: ['organization.js', 'export { create };'],
    createEnvironments: ['environments.js', 'export { createEnvironment };']
};
const loaderSource = fs.readFileSync(
    path.join(__dirname, '../src/client/index.js'),
    'utf8'
);

function evaluateModule(file, stopAt, dependencies) {
    const source = fs.readFileSync(
        path.join(__dirname, `../src/client/${file}`),
        'utf8'
    ).split(stopAt)[0]
        .replace(/^import .*;\r?\n/gm, '')
        .replace(/\bexport\s+/g, '');
    const context = vm.createContext(dependencies);
    vm.runInContext(source, context, { filename: file });
    return context;
}

async function run(name, response, options = {}) {
    const actions = [];
    const notices = [];
    const attributes = {};
    let ended = 0;
    let aborted = 0;
    let sent = 0;
    const [file, stopAt] = sourceFiles[name];
    const context = evaluateModule(file, stopAt, {
        Actions: { init: action => actions.push(action) },
        render: notice => notices.push(notice),
        uuid: () => 'key',
        btoa: value => value,
        Elements: {
            getData: async () => options.noOrganization ? [] : [
                {
                    array: 'organizations',
                    object: [{ _id: 'org', host: [{ name: 'team.example.com' }] }]
                },
                {
                    array: 'users',
                    object: [{ _id: 'user', email: 'user@example.com', password: 'secret' }]
                }
            ]
        },
        Crud: {
            ObjectId: () => 'id',
            send: async data => options.readFailure ? { error: 'read failed' } : data,
            socket: {
                organization: true,
                send: async request => {
                    if (name === 'createOrganization') {
                        assert.deepEqual(Object.keys(request).sort(), [
                            'broadcastClient',
                            'method',
                            'organization'
                        ]);
                        assert.equal(request.organization._id, 'org');
                    }
                    sent++;
                    if (options.reject) throw new Error('Connection failed');
                    return response;
                }
            }
        }
    });

    context.init();
    const registered = actions.find(action => action.name === name);
    assert.ok(registered);
    assert.equal(
        registered.endEvent,
        name === 'createOrganization' ? 'createdOrganization' : 'createdEnvironments'
    );
    await registered.callback({
        name,
        element: { setAttribute: (key, value) => { attributes[key] = value; } },
        form: options.noForm
            ? null
            : {
                querySelector: selector => ({
                    value: selector === '#organization' ? 'org' : 'example.com'
                })
            },
        abort: () => aborted++,
        end: detail => {
            ended++;
            assert.equal(detail, response);
            assert.equal(notices.length, 1);
        }
    });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].selector, '[template~="notification"]');
    return {
        ended,
        aborted,
        sent,
        notice: notices[0].data[0] || notices[0].data,
        attributes
    };
}

test('registers separate simple action observers and queries current action elements', () => {
    assert.match(loaderSource, /selector: actionSelector/);
    assert.match(loaderSource, /name: "CoCreateOrganizationsCreateOrganizationLoader"/);
    assert.match(loaderSource, /name: "CoCreateOrganizationsCreateEnvironmentsLoader"/);
    assert.match(
        loaderSource,
        /document\.querySelectorAll\(actionSelector\)\.forEach\(loadElement\)/
    );
});

for (const name of Object.keys(sourceFiles)) {
    test(`${name} ends on success with the response`, async () => {
        const result = await run(name, { success: true, message: 'Created' });
        assert.equal(result.ended, 1);
        assert.equal(result.aborted, 0);
        assert.equal(result.notice.message, 'Created');
    });

    for (const response of [
        { success: false, message: 'Failed' },
        { error: 'Denied' },
        undefined
    ]) {
        test(`${name} aborts unsuccessful or missing responses`, async () => {
            const result = await run(name, response);
            assert.equal(result.ended, 0);
            assert.equal(result.aborted, 1);
            assert.equal(result.notice.success, false);
        });
    }

    for (const options of [{ reject: true }, { noForm: true }]) {
        test(`${name} aborts exceptions`, async () => {
            const result = await run(name, {}, options);
            assert.equal(result.ended, 0);
            assert.equal(result.aborted, 1);
        });
    }
}

test('missing organization details do not send a creation request', async () => {
    const result = await run('createOrganization', {}, { noOrganization: true });
    assert.equal(result.aborted, 1);
    assert.equal(result.sent, 0);
});

test('createOrganization assigns the published subdomain href before ending', async () => {
    const result = await run('createOrganization', {
        success: true,
        message: 'Published',
        redirect: 'https://team.example.com/admin/'
    });
    assert.equal(result.attributes.href, 'https://team.example.com/admin/');
});
