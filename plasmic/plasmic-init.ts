import { initPlasmicLoader } from "@plasmicapp/loader-nextjs";
export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: "dABjTrW1fcX8adgY6nugCY",  // ID of a project you are using
      token: "hRAO59WJssDFOlihCpx4Dbdld8h8sXV9HDYREQk6vxOJHVPzq3yJt01qNXJEOlqgxny1wlnnxiziQVjckMg"  // API token for that project
    }
  ],
  // Fetches the latest revisions, whether or not they were unpublished!
  // Disable for production to ensure you render only published changes.
  preview: true,
})