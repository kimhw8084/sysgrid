import { test as base } from '@playwright/test';
import { ChaosController } from './chaosController.ts';
import { InteractionChaos } from './chaosInteractions.ts';
import { NetworkChaos } from './chaosNetwork.ts';
import { StateChaos } from './chaosState.ts';
import { createTestApiClient } from './test-api-client.ts';

// Extend the base test to include a globally pre-configured API client and ChaosController
export const test = base.extend<{ 
  chaos: ChaosController, 
  interactionChaos: InteractionChaos, 
  networkChaos: NetworkChaos,
  stateChaos: StateChaos,
  sysApi: any
}>({
  chaos: async ({}, use) => {
    const controller = new ChaosController();
    await use(controller);
    // Cleanup chaos state after each test
    controller.killAll();
  },
  interactionChaos: async ({ page, chaos }, use) => {
    const interactionTool = new InteractionChaos(page);
    chaos.register(interactionTool);
    await use(interactionTool);
  },
  networkChaos: async ({ page, chaos }, use) => {
    const networkTool = new NetworkChaos(page);
    chaos.register(networkTool);
    await use(networkTool);
  },
  stateChaos: async ({ page, chaos }, use) => {
    const stateTool = new StateChaos(page);
    chaos.register(stateTool);
    await use(stateTool);
  },
  sysApi: async ({ request, baseURL }, use) => {
    // We wrap the raw Playwright request with our deterministic headers
    // ensuring no test ever forgets the tenant or user context.
    const customRequest = createTestApiClient(request);
    await use(customRequest as any);
  }
});
