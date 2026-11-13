/**
 * Help-hub copy shared by the authoring layer (world tutorial text) and the ui layer (palette and help hubs), so both show identical wording.
 * Lives in world-objects because both authoring and ui may import that layer.
 */
import { lostGuidance } from "./vocabulary";

/**
 * Help-hub hint telling a stuck player how to return to the starting place: the desktop sentence, which serves VR until the VR variant exists.
 */
export const helpHubHomeGuidance = lostGuidance;
