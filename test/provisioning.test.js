import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createOrganizationProvisioner } from '../src/provision.js';
import { defaults } from '../src/config.js';

test('organization provisioning is enabled when the module is installed', () => {
    assert.equal(defaults.enabled, true);
});

test('organization provisioning creates, seeds, and clones an isolated repository', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cocreate-org-provision-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const template = path.join(root, 'template');
    const remote = path.join(root, 'organization.git');
    await fs.mkdir(template);

    const git = (args, cwd) => promisify(execFile)('git', args, { cwd });
    await git(['init', '-b', 'main'], template);
    await fs.writeFile(path.join(template, 'index.html'), '<main>template</main>', 'utf8');
    await git(['add', 'index.html'], template);
    await git([
        '-c', 'user.name=Test',
        '-c', 'user.email=test@example.com',
        'commit', '-m', 'Initial'
    ], template);
    await git(['branch', 'dev'], template);
    await git(['branch', 'test'], template);
    await git(['init', '--bare', remote], root);

    const updates = [];
    let repositoryExists = false;
    const server = {
        organization_id: 'platform-org',
        host: 'platform.example.com',
        crud: {
            async send(request) {
                updates.push(request.object);
                return { success: true, object: [request.object] };
            }
        },
        api: {
            async getApiConfig() { return { token: 'test-token' }; },
            async send(request) {
                if (request.endpoint === 'get-organization-repository' && !repositoryExists) {
                    const error = new Error('HTTP error! Status: 404 Not Found');
                    error.response = { status: 404 };
                    throw error;
                }
                repositoryExists = true;
                return {
                    data: {
                        name: request.data.name,
                        clone_url: remote,
                        html_url: 'https://github.com/CoCreate-organizations/tenant-org',
                        owner: { login: 'CoCreate-organizations' },
                        default_branch: 'main'
                    }
                };
            }
        }
    };
    const uploads = [];
    const provisioner = createOrganizationProvisioner({
        server,
        localFsRoot: path.join(root, 'organizations'),
        uploadRunner: async request => {
            const branches = (await git([
                'for-each-ref', '--format=%(refname:short)', 'refs/heads'
            ], remote)).stdout.trim().split('\n').sort().join(',');
            assert.equal(branches, 'dev,main,test');
            uploads.push(request);
        },
        config: {
            enabled: true,
            api: 'github-organizations',
            getEndpoint: 'get-organization-repository',
            createEndpoint: 'create-organization-repository',
            owner: 'CoCreate-organizations',
            templateUrl: template,
            gitBinary: 'git'
        }
    });

    const result = await provisioner.provisionOrganization({
        organization_id: 'tenant-org',
        organization: {
            _id: 'tenant-org',
            name: 'Tenant',
            provisioning: {
                status: 'pending',
                requested_at: '2026-09-29T00:00:00.000Z'
            }
        },
        upload: {
            apikey: 'deployment-key',
            host: 'wss://platform.example.com'
        }
    });

    assert.equal(result.provisioning.status, 'ready');
    assert.equal(result.deployment.status, 'ready');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].cwd, path.join(root, 'organizations', 'tenant-org', 'sites'));
    assert.equal(uploads[0].organization_id, 'tenant-org');
    assert.equal(uploads[0].apikey, 'deployment-key');
    assert.equal(uploads[0].host, 'wss://platform.example.com');
    assert.equal(updates[0].provisioning.status, 'provisioning');
    assert.equal(updates.at(-1).provisioning.status, 'ready');
    assert.equal(
        await fs.readFile(
            path.join(root, 'organizations', 'tenant-org', 'sites', 'index.html'),
            'utf8'
        ),
        '<main>template</main>'
    );
    assert.equal(
        (await git([
            'for-each-ref', '--format=%(refname:short)', 'refs/heads'
        ], remote)).stdout.trim().split('\n').sort().join(','),
        'dev,main,test'
    );
});

test('organization provisioning remains ready when remote backup credentials are missing', async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cocreate-org-failure-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const template = path.join(root, 'template');
    await fs.mkdir(template);
    const git = (args, cwd) => promisify(execFile)('git', args, { cwd });
    await git(['init', '-b', 'main'], template);
    await fs.writeFile(path.join(template, 'index.html'), '<main>template</main>', 'utf8');
    await git(['add', 'index.html'], template);
    await git([
        '-c', 'user.name=Test',
        '-c', 'user.email=test@example.com',
        'commit', '-m', 'Initial'
    ], template);
    const updates = [];
    const server = {
        organization_id: 'platform-org',
        host: 'platform.example.com',
        crud: {
            async send(request) {
                updates.push(request.object);
                return { success: true, object: [request.object] };
            }
        },
        api: {
            async getApiConfig() { return { token: '' }; },
            async send() { throw new Error('must not be called'); }
        }
    };
    const uploads = [];
    let uploadError;
    const provisioner = createOrganizationProvisioner({
        server,
        localFsRoot: path.join(root, 'organizations'),
        uploadRunner: async request => {
            if (uploadError) throw uploadError;
            uploads.push(request);
        },
        config: {
            enabled: true,
            api: 'github-organizations',
            owner: 'CoCreate-organizations',
            templateUrl: template,
            gitBinary: 'git'
        }
    });

    const result = await provisioner.provisionOrganization({
        organization_id: 'tenant-org',
        organization: { _id: 'tenant-org' },
        upload: {
            apikey: 'deployment-key',
            host: 'wss://platform.example.com'
        }
    });
    assert.equal(
        (await fs.stat(path.join(root, 'organizations', 'tenant-org', 'sites'))).isDirectory(),
        true
    );
    assert.equal(
        (await fs.stat(path.join(root, 'organizations', 'tenant-org', '.ai'))).isDirectory(),
        true
    );
    assert.equal(
        await fs.readFile(
            path.join(root, 'organizations', 'tenant-org', 'sites', 'index.html'),
            'utf8'
        ),
        '<main>template</main>'
    );
    assert.equal(result.provisioning.status, 'ready');
    assert.equal(result.deployment.status, 'ready');
    assert.equal(uploads.length, 1);
    assert.equal(result.git.backup.status, 'failed');
    assert.match(result.git.backup.error, /GitHub credential is missing/);
    assert.equal(updates.at(-1).provisioning.status, 'ready');
    assert.equal(updates.at(-1).git.backup.status, 'failed');

    uploadError = new Error('Upload unavailable');
    await assert.rejects(
        provisioner.provisionOrganization({
            organization_id: 'tenant-org',
            organization: { _id: 'tenant-org' },
            upload: {
                apikey: 'deployment-key',
                host: 'wss://platform.example.com'
            }
        }),
        /Upload unavailable/
    );
    assert.equal(updates.at(-1).provisioning.status, 'failed');
    assert.equal(updates.at(-1).deployment.status, 'failed');
});
