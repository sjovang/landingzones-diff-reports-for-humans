@description('The azd environment name used to keep resource names unique.')
param environmentName string

@description('Azure region for the application resources.')
param location string = resourceGroup().location

@description('Immutable OCI image reference for the web app, including its sha256 digest.')
param webImage string

var resourceToken = uniqueString(subscription().id, resourceGroup().id, location, environmentName)
var storageAccountName = 'azst${resourceToken}'
var webAppName = 'azapp${resourceToken}'
var functionAppName = 'azfn${resourceToken}'
var webIdentityName = 'azidweb${resourceToken}'
var functionIdentityName = 'azidfn${resourceToken}'
var appServicePlanName = 'azasp${resourceToken}'
var workspaceName = 'azlaw${resourceToken}'
var appInsightsName = 'azai${resourceToken}'

var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var blobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var queueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var tableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource storage 'Microsoft.Storage/storageAccounts@2026-09-01' = {
  name: storageAccountName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: webIdentityName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

resource functionIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: functionIdentityName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: workspaceName
  location: location
  tags: {
    'azd-env-name': environmentName
  }
  properties: {
    retentionInDays: 30
  }
  sku: {
    name: 'PerGB2018'
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: {
    'azd-env-name': environmentName
  }
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableIpMasking: false
  }
}

resource appServicePlan 'Microsoft.Web/serverFarms@2026-08-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  tags: {
    'azd-env-name': environmentName
  }
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    family: 'B'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2026-08-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  tags: {
    'azd-env-name': environmentName
    'azd-service-name': 'web'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${webIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      appCommandLine: ''
      alwaysOn: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'DOCKER|${webImage}'
      minTlsVersion: '1.2'
      cors: {
        allowedOrigins: [
          'https://${webAppName}.azurewebsites.net'
        ]
        supportCredentials: false
      }
    }
  }
}

// Keep portal-managed registry credentials when provisioning again.
resource webSettings 'Microsoft.Web/sites/config@2026-08-01' = {
  parent: webApp
  name: 'appsettings'
  properties: union(list('${webApp.id}/config/appsettings', '2026-08-01').properties, {
    AZURE_STORAGE_ACCOUNT_NAME: storage.name
    AZURE_CLIENT_ID: webIdentity.properties.clientId
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
    WEBSITES_PORT: '3000'
    WEBSITE_RUN_FROM_PACKAGE: '0'
    DOCKER_REGISTRY_SERVER_URL: 'https://ghcr.io'
  })
}

resource functionApp 'Microsoft.Web/sites@2026-08-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  tags: {
    'azd-env-name': environmentName
    'azd-service-name': 'worker'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${functionIdentity.id}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      alwaysOn: true
      ftpsState: 'Disabled'
      http20Enabled: true
      linuxFxVersion: 'Node|22'
      minTlsVersion: '1.2'
    }
  }
}

// Preserve optional portal-managed settings such as the GitHub discovery token.
resource functionSettings 'Microsoft.Web/sites/config@2026-08-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: union(list('${functionApp.id}/config/appsettings', '2026-08-01').properties, {
    FUNCTIONS_EXTENSION_VERSION: '~4'
    FUNCTIONS_WORKER_RUNTIME: 'node'
    AzureWebJobsFeatureFlags: 'EnableWorkerIndexing'
    WEBSITE_RUN_FROM_PACKAGE: '1'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    WEBSITE_NODE_DEFAULT_VERSION: '~22'
    AzureWebJobsStorage__accountName: storage.name
    AzureWebJobsStorage__credential: 'managedidentity'
    AzureWebJobsStorage__clientId: functionIdentity.properties.clientId
    AZURE_STORAGE_ACCOUNT_NAME: storage.name
    AZURE_CLIENT_ID: functionIdentity.properties.clientId
    COMPARISON_QUEUE_NAME: 'report-jobs'
    RELEASE_SYNC_SCHEDULE: '0 0 * * * *'
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
  })
}

resource webBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webIdentity.id, blobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webIdentity.id, queueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueDataContributorRoleId)
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webIdentity.id, tableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataContributorRoleId)
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionBlobOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, blobDataOwnerRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataOwnerRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionBlobContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, blobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, queueDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource functionTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionIdentity.id, tableDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataContributorRoleId)
    principalId: functionIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource webDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'azdsw${resourceToken}'
  scope: webApp
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

resource functionDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'azdsf${resourceToken}'
  scope: functionApp
  properties: {
    workspaceId: workspace.id
    logs: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output AZURE_STORAGE_ACCOUNT_NAME string = storage.name
output WEB_APP_NAME string = webApp.name
output WEB_APP_URL string = 'https://${webApp.properties.defaultHostName}'
output FUNCTION_APP_NAME string = functionApp.name
