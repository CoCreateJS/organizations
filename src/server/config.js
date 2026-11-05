import config from '@cocreate/config';
import { dotNotationToObject } from '@cocreate/utils';

export const defaults = {
    enabled: true,
    databaseWorkflow: 'create-organization-database',
    organizationWorkflow: 'create-organization',
    clusterWorkflow: 'create-organization-cluster',
    repositoryWorkflow: 'create-organization-repository',
    databaseProvisioning: {},
    clusterProvisioning: {
        initialDeployment: { cloud: '65f8ca227b39a3c1a8904e02', region: 'us-east-1', vmType: 't3a.small' },
        repositories: [],
        scaleIn: { minClusterSize: 0 }
    },
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
        clusterProvisioning: structuredClone(defaults.clusterProvisioning),
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
