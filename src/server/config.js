import config from '@cocreate/config';
import { dotNotationToObject } from '@cocreate/utils';
import { join } from 'node:path';

export const defaults = {
    enabled: true,
    localFsRoot: join(process.cwd(), 'organizations'),
    api: 'github-organizations',
    getEndpoint: 'get-organization-repository',
    createEndpoint: 'create-organization-repository',
    owner: 'CoCreate-organizations',
    templateUrl: 'https://github.com/CoCreateJS/CoCreate-app-template.git',
    gitBinary: 'git',
    uploadBinary: 'coc',
    uploadTimeout: 300000
};

export async function resolveOrganizationsConfig(server, options = {}) {
    const organizationsConfig = { ...defaults };
    const localConfig = config.get('organizations');
    if (localConfig) dotNotationToObject(localConfig, organizationsConfig);

    const databaseConfig = await config.query({
        type: 'organizations',
        organization_id: server.organization_id
    }, server.crud);
    dotNotationToObject(databaseConfig, organizationsConfig);
    dotNotationToObject(options, organizationsConfig);
    return organizationsConfig;
}

export default resolveOrganizationsConfig;
