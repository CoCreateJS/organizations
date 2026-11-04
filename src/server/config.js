import config from '@cocreate/config';
import { dotNotationToObject } from '@cocreate/utils';

export const defaults = {
    enabled: true,
    databaseWorkflow: 'create-organization-database',
    organizationWorkflow: 'create-organization',
    repositoryWorkflow: 'create-organization-repository',
    databaseProvisioning: {},
    repositoryProvisioning: {
        api: 'github-organizations',
        templateOwner: 'CoCreateJS',
        templateRepository: 'CoCreate-app-template'
    }
};

export async function resolveOrganizationsConfig(server, options = {}) {
    const organizationsConfig = {
        ...defaults,
        databaseProvisioning: { ...defaults.databaseProvisioning },
        repositoryProvisioning: { ...defaults.repositoryProvisioning }
    };
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
