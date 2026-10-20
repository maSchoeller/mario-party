// Würfel-Bande – Azure infrastructure (OPS-01..04). Not deployed yet (see docs/OPEN_POINTS.md).
// Static Web Apps (Free) for the clients, Container Apps (Consumption, 0–1 replica) for the
// Node server, Storage (Blob for large assets, Table for save games), Application Insights
// and a monthly budget alert at 10 €.
targetScope = 'resourceGroup'

@description('Name prefix for all resources')
param prefix string = 'wuerfelbande'
param location string = resourceGroup().location
@description('Container image, e.g. ghcr.io/<owner>/wuerfel-bande-server:latest')
param serverImage string
@description('E-mail for the budget alert (OPS-02)')
param budgetEmail string
param budgetStartDate string = '2026-11-01'

var storageName = take(toLower(replace('${prefix}st${uniqueString(resourceGroup().id)}', '-', '')), 24)

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${prefix}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${prefix}-ai'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableIpMasking: false
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
    minimumTlsVersion: 'TLS1_2'
  }
}

resource blob 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        { allowedOrigins: ['*'], allowedMethods: ['GET', 'HEAD'], allowedHeaders: ['*'], exposedHeaders: ['*'], maxAgeInSeconds: 86400 }
      ]
    }
  }
}

resource assets 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blob
  name: 'assets'
  properties: { publicAccess: 'Blob' }
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource savesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'saves'
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${prefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource server 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${prefix}-server'
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      secrets: [
        { name: 'storage-conn', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}' }
        { name: 'ai-conn', value: insights.properties.ConnectionString }
      ]
    }
    template: {
      containers: [
        {
          name: 'server'
          image: serverImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-conn' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'ai-conn' }
          ]
          probes: [
            { type: 'Liveness', httpGet: { path: '/api/health', port: 8080 }, periodSeconds: 30 }
          ]
        }
      ]
      // OPS-04: in-memory lobby registry -> exactly one replica at most; scale to zero when idle
      scale: { minReplicas: 0, maxReplicas: 1, rules: [ { name: 'http', http: { metadata: { concurrentRequests: '200' } } } ] }
    }
  }
}

resource web 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${prefix}-web'
  location: 'westeurope'
  sku: { name: 'Free', tier: 'Free' }
  properties: {}
}

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: '${prefix}-budget'
  properties: {
    category: 'Cost'
    amount: 15
    timeGrain: 'Monthly'
    timePeriod: { startDate: budgetStartDate }
    notifications: {
      at10eur: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 67 // 10 € of 15 €
        thresholdType: 'Actual'
        contactEmails: [ budgetEmail ]
      }
      forecast: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [ budgetEmail ]
      }
    }
  }
}

output serverUrl string = 'https://${server.properties.configuration.ingress.fqdn}'
output webHostname string = web.properties.defaultHostname
output assetsUrl string = '${storage.properties.primaryEndpoints.blob}assets'
