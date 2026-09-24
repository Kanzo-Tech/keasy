"use client";

import { useMosaic } from "@kanzo-tech/ui/analytics";

/** discovery-ask's import only; it goes when that file moves beside the discover route. */
export const useCoordinator = () => useMosaic().coordinator;
