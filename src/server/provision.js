import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const provisioningLocks = new Map();
const ORGANIZATION_SEGMENT = /^[A-Za-z0-9_-]+$/;

function createWorkspaceResolver(baseDirectory, workspaceDirectory = 'sites') {
    const root = path.resolve(baseDirectory);

    const organizationRoot = (organization_id) => {
        if (!organization_id || !ORGANIZATION_SEGMENT.test(organization_id)) {
            throw new Error('A valid organization_id is required for provisioning');
        }
        return path.join(root, organization_id, workspaceDirectory);
    };

    const ensure = async (organization_id) => {
        const organizationDirectory = path.join(root, organization_id);
        const workspace = organizationRoot(organization_id);
        await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
        const realRoot = await fs.realpath(root);
        const realOrganization = await fs.realpath(organizationDirectory);
        const realWorkspace = await fs.realpath(workspace);
        if (!realOrganization.startsWith(`${realRoot}${path.sep}`) ||
            !realWorkspace.startsWith(`${realOrganization}${path.sep}`)) {
            throw new Error('Organization workspace escapes the configured root');
        }
        return workspace;
    };

    return { organizationRoot, ensure };
}

const sanitizedEnvironment = () => Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
);

function gitEnvironment(token) {
    const authorization = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    return {
        ...sanitizedEnvironment(),
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`
    };
}

async function runGit(gitBinary, args, options = {}) {
    return execFileAsync(gitBinary, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: options.timeout ?? 120000,
        windowsHide: true,
        env: options.token ? gitEnvironment(options.token) : {
            ...sanitizedEnvironment(),
            GIT_TERMINAL_PROMPT: '0'
        }
    });
}

function errorStatus(error) {
    return error?.response?.status ?? Number(
        String(error?.message).match(/Status:\s*(\d+)/)?.[1]
    );
}

export function createOrganizationProvisioner({
    server,
    localFsRoot,
    config = {},
    uploadRunner
}) {
    const workspaces = createWorkspaceResolver(localFsRoot);
    const aiWorkspaces = createWorkspaceResolver(localFsRoot, '.ai');
    const gitBinary = config.gitBinary || 'git';

    async function updateOrganization(organization_id, provisioning, git, deployment) {
        const object = { _id: organization_id, provisioning };
        if (git) object.git = git;
        if (deployment) object.deployment = deployment;
        for (const database of [server.organization_id, organization_id]) {
            const result = await server.crud.send({
                method: 'object.update',
                database,
                organization_id: server.organization_id,
                array: 'organizations',
                object: { ...object }
            });
            if (!result || result.error || result.success === false) {
                throw new Error(
                    `Unable to update organization provisioning state in ${database}`
                );
            }
        }
    }

    async function sendApi(endpoint, method, organization, data) {
        return server.api.send({
            api: config.api,
            endpoint,
            method,
            organization_id: server.organization_id,
            host: server.host,
            data: {
                name: organization._id,
                description: `${organization.name || 'CoCreate organization'} managed website`,
                ...data
            }
        });
    }

    async function resolveRepository(organization) {
        try {
            const existing = await sendApi(
                config.getEndpoint,
                'get',
                organization
            );
            return existing.data;
        } catch (error) {
            if (errorStatus(error) !== 404) throw error;
        }

        try {
            const created = await sendApi(
                config.createEndpoint,
                'post',
                organization
            );
            return created.data;
        } catch (error) {
            // A concurrent worker may have created the repository after the
            // read. Resolve that race without duplicating or renaming it.
            if (errorStatus(error) !== 422) throw error;
            const existing = await sendApi(
                config.getEndpoint,
                'get',
                organization
            );
            return existing.data;
        }
    }

    async function seedRepository(remoteUrl, token) {
        const { stdout } = await runGit(gitBinary, ['ls-remote', remoteUrl], { token });
        if (stdout.trim()) return false;

        const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cocreate-org-'));
        const mirrorPath = path.join(temporaryRoot, 'repository.git');
        try {
            await runGit(gitBinary, ['clone', '--mirror', config.templateUrl, mirrorPath]);
            await runGit(gitBinary, ['remote', 'set-url', 'origin', remoteUrl], {
                cwd: mirrorPath
            });
            await runGit(gitBinary, ['push', '--mirror', 'origin'], {
                cwd: mirrorPath,
                token
            });
            return true;
        } finally {
            await fs.rm(temporaryRoot, { recursive: true, force: true });
        }
    }

    async function cloneTemplate(organization_id) {
        const workspace = await workspaces.ensure(organization_id);
        await aiWorkspaces.ensure(organization_id);

        try {
            const metadata = await fs.lstat(path.join(workspace, '.git'));
            if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
                throw new Error('Organization Git metadata must be a local directory');
            }
            return workspace;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }

        const entries = await fs.readdir(workspace);
        if (entries.length) {
            throw new Error('Organization sites directory is not empty and is not a Git repository');
        }
        await runGit(gitBinary, ['clone', config.templateUrl, '.'], {
            cwd: workspace
        });
        await runGit(gitBinary, ['remote', 'rename', 'origin', 'upstream'], {
            cwd: workspace
        });
        return workspace;
    }

    async function configureRemote(workspace, remoteUrl, token, defaultBranch) {
        try {
            await runGit(gitBinary, ['remote', 'get-url', 'origin'], { cwd: workspace });
            await runGit(gitBinary, ['remote', 'set-url', 'origin', remoteUrl], {
                cwd: workspace
            });
        } catch {
            await runGit(gitBinary, ['remote', 'add', 'origin', remoteUrl], {
                cwd: workspace
            });
        }
        await runGit(gitBinary, ['fetch', 'origin'], { cwd: workspace, token });
        await runGit(gitBinary, ['push', '--all', 'origin'], { cwd: workspace, token });
        await runGit(gitBinary, ['push', '--tags', 'origin'], { cwd: workspace, token });
        if (defaultBranch) {
            try {
                await runGit(gitBinary, [
                    'branch', '--set-upstream-to', `origin/${defaultBranch}`, defaultBranch
                ], { cwd: workspace });
            } catch {
                // A template may use a different local default branch. The
                // explicit origin remains valid for subsequent synchronization.
            }
        }
    }

    async function backupRepository(organization, workspace) {
        if (!server.api?.send || !server.api?.getApiConfig) {
            throw new Error('The server API service is unavailable for repository backup');
        }
        const apiConfig = await server.api.getApiConfig({
            organization_id: server.organization_id,
            host: server.host
        }, config.api);
        const token = apiConfig.token || apiConfig.key;
        if (typeof token !== 'string' || !token) {
            throw new Error(`GitHub credential is missing for API '${config.api}'`);
        }

        const repository = await resolveRepository(organization);
        const remoteUrl = repository?.clone_url ||
            `https://github.com/${config.owner}/${organization._id}.git`;
        const defaultBranch = repository?.default_branch || 'main';
        await seedRepository(remoteUrl, token);
        await configureRemote(workspace, remoteUrl, token, defaultBranch);
        return {
            provider: 'github',
            owner: repository?.owner?.login || config.owner,
            repository: repository?.name || organization._id,
            url: repository?.html_url ||
                `https://github.com/${config.owner}/${organization._id}`,
            clone_url: remoteUrl,
            default_branch: defaultBranch,
            backup: {
                status: 'ready',
                completed_at: new Date().toISOString()
            }
        };
    }

    async function uploadSite(organization_id, workspace, upload = {}) {
        if (typeof upload.apikey !== 'string' || !upload.apikey) {
            throw new Error('An upload API key is required to publish the organization');
        }
        if (typeof upload.host !== 'string' || !upload.host) {
            throw new Error('An upload host is required to publish the organization');
        }
        const request = {
            cwd: workspace,
            organization_id,
            apikey: upload.apikey,
            host: upload.host
        };
        if (uploadRunner) {
            await uploadRunner(request);
        } else {
            await execFileAsync(config.uploadBinary || 'coc', ['upload'], {
                cwd: workspace,
                encoding: 'utf8',
                maxBuffer: MAX_OUTPUT_BYTES,
                timeout: config.uploadTimeout ?? 300000,
                windowsHide: true,
                env: {
                    ...sanitizedEnvironment(),
                    organization_id,
                    apikey: upload.apikey,
                    host: upload.host
                }
            });
        }
        return {
            status: 'ready',
            completed_at: new Date().toISOString()
        };
    }

    async function execute(organization, upload) {
        const organization_id = organization?._id;
        // Materialize the organization boundary before contacting GitHub. This
        // makes the local lifecycle match organization creation and leaves an
        // observable, isolated workspace when a remote operation fails.
        await workspaces.ensure(organization_id);
        await aiWorkspaces.ensure(organization_id);

        await updateOrganization(organization_id, {
            status: 'provisioning',
            requested_at: organization.provisioning?.requested_at,
            started_at: new Date().toISOString()
        });

        const workspace = await cloneTemplate(organization_id);
        let provisioning = {
            status: 'provisioning',
            requested_at: organization.provisioning?.requested_at,
            started_at: new Date().toISOString()
        };
        let git = {
            template_url: config.templateUrl,
            backup: { status: 'pending' }
        };
        let deployment = { status: 'pending' };
        await updateOrganization(organization_id, provisioning, git, deployment);

        try {
            git = await backupRepository(organization, workspace);
        } catch (error) {
            git = {
                ...git,
                provider: 'github',
                owner: config.owner,
                repository: organization_id,
                backup: {
                    status: 'failed',
                    failed_at: new Date().toISOString(),
                    error: String(error.message || error).slice(0, 1000)
                }
            };
            console.warn(
                `[@cocreate/organizations] Remote backup unavailable for ${organization_id}:`,
                error.message
            );
        }

        deployment = {
            status: 'uploading',
            started_at: new Date().toISOString()
        };
        await updateOrganization(organization_id, provisioning, git, deployment);
        deployment = await uploadSite(organization_id, workspace, upload);
        provisioning = {
            status: 'ready',
            requested_at: organization.provisioning?.requested_at,
            completed_at: new Date().toISOString()
        };
        await updateOrganization(organization_id, provisioning, git, deployment);
        return { organization_id, provisioning, git, deployment, workspace };
    }

    async function provisionOrganization(payload = {}) {
        if (!config.enabled) {
            return { organization_id: payload.organization_id, skipped: true };
        }
        const organization = {
            ...(payload.organization || {}),
            _id: payload.organization_id || payload.organization?._id
        };
        const organization_id = organization._id;
        if (!organization_id) throw new Error('organization_id is required');
        if (provisioningLocks.has(organization_id)) {
            return provisioningLocks.get(organization_id);
        }

        const operation = execute(organization, payload.upload).catch(async (error) => {
            const failed_at = new Date().toISOString();
            const provisioning = {
                status: 'failed',
                requested_at: organization.provisioning?.requested_at,
                failed_at,
                error: String(error.message || error).slice(0, 1000)
            };
            try {
                await updateOrganization(organization_id, provisioning, null, {
                    status: 'failed',
                    failed_at,
                    error: provisioning.error
                });
            } catch (updateError) {
                console.error(
                    `[@cocreate/organizations] Failed to record provisioning error for ${organization_id}:`,
                    updateError.message
                );
            }
            throw error;
        }).finally(() => {
            if (provisioningLocks.get(organization_id) === operation) {
                provisioningLocks.delete(organization_id);
            }
        });
        provisioningLocks.set(organization_id, operation);
        return operation;
    }

    return { provisionOrganization };
}

export default createOrganizationProvisioner;
