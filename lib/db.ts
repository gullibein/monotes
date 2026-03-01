import { init, i } from '@instantdb/react'

const APP_ID = '2e644333-c3bd-4fda-be0f-05c6a7025772'

const schema = i.schema({
  entities: {
    userState: i.entity({
      userId: i.string().indexed(),
      workspaces: i.any(),
      activeWorkspaceId: i.string(),
      savedAt: i.number(),
    }),
  },
})

export const db = init({ appId: APP_ID, schema })
