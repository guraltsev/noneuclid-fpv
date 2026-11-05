/**
 * The geodesic model's client part (design 013 sections 9.1 and 12.1): the tools the module contributes to the shell. Today that is the tie tool, unless the experience leaves it out with `tieTool: false`.
 */
import type { ModuleClient } from "../../engine/moduleTypes";
import { defaultGeodesicModelOptions, type GeodesicModelOptions } from "./api";
import { createTieToolDescriptor } from "./tieTool";

/** Creates the client part; pass the same options as the world part. */
export function geodesicModelClient(options: Partial<GeodesicModelOptions> = {}): ModuleClient {
  const { tieTool } = { ...defaultGeodesicModelOptions, ...options };
  return { tools: tieTool ? [createTieToolDescriptor()] : [] };
}
