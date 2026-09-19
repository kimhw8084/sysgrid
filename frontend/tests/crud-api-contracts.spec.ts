import { clickResilientButton } from './helpers/sysgrid';
import { expect } from '@playwright/test';
import { test } from './helpers/sysgrid-test';
import {
  createAsset,
  createConnection,
  createExternalEntity,
  createMonitoring,
  createProject,
  createService,
  createFarMode,
  createInvestigation
} from './helpers/sysgrid'

const apiBase = process.env.PW_API_BASE || 'http://127.0.0.1:8000/api/v1'

test.describe('CRUD API contracts', () => {
  test('keeps assets, services, and monitoring CRUD free of write-time ORM errors', async ({ sysApi: request }) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const asset = await createAsset(request, {
      name: `PW-CRUD-ASSET-${stamp}`,
      system: `PW-CRUD-SYS-${stamp}`,
      status: 'Active',
      model: 'R760',
      type: 'Physical',
      serial_number: `PW-CRUD-SN-${stamp}`,
      asset_tag: `PW-CRUD-TAG-${stamp}`,
      owner: 'ops-primary',
      business_unit: 'Operations'
    })

    const assetUpdate = await request.put(`${apiBase}/devices/${asset.id}`, {
      data: { ...asset, owner: 'ops-secondary', role: 'Database Host' }
    })
    expect(assetUpdate.ok(), await assetUpdate.text()).toBeTruthy()
    expect((await assetUpdate.json()).owner).toBe('ops-secondary')

    const service = await createService(request, {
      name: `PW-CRUD-SVC-${stamp}`,
      service_type: 'Database',
      status: 'Active',
      version: '1.0.0',
      environment: 'Production',
      device_id: asset.id,
      purpose: 'CRUD contract validation'
    })

    const serviceUpdate = await request.put(`${apiBase}/logical-services/${service.id}`, {
      data: { ...service, version: '1.1.0', purpose: 'Updated CRUD contract validation' }
    })
    expect(serviceUpdate.ok(), await serviceUpdate.text()).toBeTruthy()
    const updatedService = await serviceUpdate.json()
    expect(updatedService.version).toBe('1.1.0')

    const monitoring = await createMonitoring(request, {
      device_id: asset.id,
      category: 'Hardware',
      status: 'Existing',
      title: `PW-CRUD-MON-${stamp}`,
      platform: 'Prometheus',
      purpose: 'Contract coverage',
      impact: 'Contract coverage impact',
      notification_method: 'Slack',
      severity: 'Warning',
      owners: [
        { name: 'Taylor Ops', external_id: 'taylor.ops@example.com', role: 'Primary Support' }
      ]
    })

    const monitoringUpdate = await request.put(`${apiBase}/monitoring/${monitoring.id}`, {
      data: {
        ...monitoring,
        title: `${monitoring.title}-EDITED`,
        purpose: 'Updated through full-payload regression coverage'
      }
    })
    expect(monitoringUpdate.ok(), await monitoringUpdate.text()).toBeTruthy()
    const updatedMonitoring = await monitoringUpdate.json()
    expect(updatedMonitoring.title).toContain('-EDITED')

    const monitoringDelete = await request.delete(`${apiBase}/monitoring/${monitoring.id}`)
    expect(monitoringDelete.ok(), await monitoringDelete.text()).toBeTruthy()

    const serviceDelete = await request.delete(`${apiBase}/logical-services/${service.id}`)
    expect(serviceDelete.ok(), await serviceDelete.text()).toBeTruthy()
  })

  test('keeps knowledge, research, and projects CRUD durable through read-update-delete cycles', async ({ sysApi: request }) => {
    test.skip(process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1', 'Deferred preview-domain CRUD; exercised by the root-preview/full historical suite')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const knowledgeCreate = await request.post(`${apiBase}/knowledge`, {
      data: {
        category: 'BKM',
        title: `PW-CRUD-KB-${stamp}`,
        content: 'Initial operational knowledge',
        tags: ['Playwright', 'CRUD']
      }
    })
    expect(knowledgeCreate.ok()).toBeTruthy()
    const knowledge = await knowledgeCreate.json()

    const knowledgeUpdate = await request.put(`${apiBase}/knowledge/${knowledge.id}`, {
      data: {
        ...knowledge,
        content: 'Updated operational knowledge',
        status: 'Published'
      }
    })
    expect(knowledgeUpdate.ok()).toBeTruthy()
    const updatedKnowledge = await knowledgeUpdate.json()
    expect(updatedKnowledge.content).toBe('Updated operational knowledge')

    const investigation = await createInvestigation(request, {
      title: `PW-CRUD-RES-${stamp}`,
      status: 'OPEN',
      priority: 'MEDIUM',
      systems: [`PW-CRUD-SYS-${stamp}`],
      initiation_at: '2032-01-01T00:00:00'
    })

    const investigationUpdate = await request.put(`${apiBase}/investigations/${investigation.id}`, {
      data: {
        ...investigation,
        status: 'ANALYZING',
        hypothesis: 'Updated through CRUD contract coverage'
      }
    })
    expect(investigationUpdate.ok()).toBeTruthy()
    expect((await investigationUpdate.json()).status).toBe('ANALYZING')

    const project = await createProject(request, {
      name: `PW-CRUD-PROJ-${stamp}`,
      type: 'Strategic',
      status: 'Planning',
      priority: 'Medium'
    })

    const projectUpdate = await request.put(`${apiBase}/projects/${project.id}`, {
      data: {
        name: project.name,
        type: project.type,
        status: 'Active',
        priority: 'High',
        summary: 'CRUD contract upgrade path'
      }
    })
    expect(projectUpdate.ok()).toBeTruthy()
    expect((await projectUpdate.json()).status).toBe('Active')

    const investigationDelete = await request.delete(`${apiBase}/investigations/${investigation.id}`)
    expect(investigationDelete.ok()).toBeTruthy()

    const projectDelete = await request.delete(`${apiBase}/projects/${project.id}`)
    expect(projectDelete.ok()).toBeTruthy()

    const knowledgeDelete = await request.delete(`${apiBase}/knowledge/${knowledge.id}`)
    expect(knowledgeDelete.ok()).toBeTruthy()
  })

  test('keeps network, external, and FAR CRUD flows stable with realistic payloads', async ({ sysApi: request }) => {
    test.skip(process.env.SYSGRID_VERIFY_PROFILE === 'normal-v1', 'Deferred external/FAR CRUD; exercised by the root-preview/full historical suite')
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const source = await createAsset(request, {
      name: `PW-CRUD-NET-A-${stamp}`,
      system: `PW-CRUD-NET-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-CRUD-NET-SN-A-${stamp}`,
      asset_tag: `PW-CRUD-NET-TAG-A-${stamp}`,
      owner: 'netops',
      business_unit: 'Operations'
    })
    const target = await createAsset(request, {
      name: `PW-CRUD-NET-B-${stamp}`,
      system: `PW-CRUD-NET-${stamp}`,
      status: 'Active',
      model: 'R650',
      type: 'Physical',
      serial_number: `PW-CRUD-NET-SN-B-${stamp}`,
      asset_tag: `PW-CRUD-NET-TAG-B-${stamp}`,
      owner: 'netops',
      business_unit: 'Operations'
    })

    const connection = await createConnection(request, {
      device_a_id: source.id,
      source_port: 'eth0',
      device_b_id: target.id,
      target_port: 'eth1',
      link_type: 'Data',
      purpose: 'CRUD contract connectivity',
      cable_type: 'Fiber',
      speed_gbps: 10,
      unit: 'Gbps',
      status: 'Active'
    })

    const connectionUpdate = await request.put(`${apiBase}/networks/connections/${connection.id}`, {
      data: {
        ...connection,
        device_a_id: source.id,
        device_b_id: target.id,
        source_port: 'eth0',
        target_port: 'eth1',
        purpose: 'Updated CRUD contract connectivity',
        speed_gbps: 25
      }
    })
    expect(connectionUpdate.ok()).toBeTruthy()
    expect((await connectionUpdate.json()).speed_gbps).toBe(25)

    const externalEntity = await createExternalEntity(request, {
      name: `PW-CRUD-EXT-${stamp}`,
      type: 'API',
      owner_organization: 'PartnerCo',
      owner_team: 'B2B',
      status: 'Active',
      environment: 'Production',
      description: 'External CRUD contract validation',
      metadata_json: {
        base_url: 'https://partner.example.com',
        auth_type: 'token'
      }
    })

    const externalUpdate = await request.put(`${apiBase}/intelligence/entities/${externalEntity.id}`, {
      data: {
        ...externalEntity,
        status: 'Maintenance',
        description: 'Updated external CRUD contract validation'
      }
    })
    expect(externalUpdate.ok()).toBeTruthy()
    expect((await externalUpdate.json()).status).toBe('Maintenance')

    const farMode = await createFarMode(request, {
      system_name: `PW-CRUD-FAR-${stamp}`,
      title: `PW-CRUD-FAR-MODE-${stamp}`,
      effect: 'Contract failure mode',
      severity: 6,
      occurrence: 3,
      detection: 2,
      affected_assets: [source.id]
    })

    const farUpdate = await request.put(`${apiBase}/far/modes/${farMode.id}`, {
      data: {
        ...farMode,
        severity: 8,
        occurrence: 4,
        detection: 2,
        effect: 'Updated contract failure mode'
      }
    })
    expect(farUpdate.ok()).toBeTruthy()
    expect((await farUpdate.json()).severity).toBe(8)

    const connectionDelete = await request.delete(`${apiBase}/networks/connections/${connection.id}`)
    expect(connectionDelete.ok()).toBeTruthy()

    const externalDelete = await request.delete(`${apiBase}/intelligence/entities/${externalEntity.id}`)
    expect(externalDelete.ok()).toBeTruthy()

    const farDelete = await request.delete(`${apiBase}/far/modes/${farMode.id}`)
    expect(farDelete.ok()).toBeTruthy()
  })
})
