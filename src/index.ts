import { Butler } from './butler/Butler.js';
import { CapturePipeline } from './integrations/CapturePipeline.js';
import { IntegrationRegistry } from './integrations/registry.js';
import { Delivery } from './modules/delivery.js';
import { Finance } from './modules/finance.js';
import { Kitchen } from './modules/kitchen.js';
import { Maintenance } from './modules/maintenance.js';
import { Coordination } from './modules/tasks.js';
import { Wardrobe } from './modules/wardrobe.js';
import { Wishlist } from './modules/wishlist.js';
import { Platform } from './platform.js';

export * from './graph/types.js';
export * from './graph/HouseholdGraph.js';
export * from './permissions/roles.js';
export * from './permissions/AccessControl.js';
export * from './integrations/understand.js';
export * from './integrations/registry.js';
export * from './integrations/CapturePipeline.js';
export * from './modules/tasks.js';
export * from './modules/finance.js';
export * from './modules/kitchen.js';
export * from './modules/delivery.js';
export * from './modules/maintenance.js';
export * from './modules/wishlist.js';
export * from './modules/wardrobe.js';
export * from './butler/Butler.js';
export * from './platform.js';

/** Wires every module onto one shared graph and permission system. */
export function createHomeApp(options: { clock?: () => Date } = {}) {
  const platform = new Platform(options.clock);
  const coordination = new Coordination(platform);
  const finance = new Finance(platform, coordination);
  const kitchen = new Kitchen(platform);
  const delivery = new Delivery(platform);
  const maintenance = new Maintenance(platform);
  const wishlist = new Wishlist(platform);
  const wardrobe = new Wardrobe(platform);
  const integrations = new IntegrationRegistry(platform);
  const capture = new CapturePipeline(platform, delivery, finance, integrations);
  const butler = new Butler(platform, kitchen, finance, coordination, delivery, maintenance);
  return { platform, coordination, finance, kitchen, delivery, maintenance, wishlist, wardrobe, integrations, capture, butler };
}

export type HomeApp = ReturnType<typeof createHomeApp>;
