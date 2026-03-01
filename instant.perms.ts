import type { InstantRules } from '@instantdb/react'

// Each user can only read/write their own userState record.
const rules = {
  userState: {
    allow: {
      view:   'auth.id != null && data.userId == auth.id',
      create: 'auth.id != null',
      update: 'auth.id != null && data.userId == auth.id',
      delete: 'auth.id != null && data.userId == auth.id',
    },
  },
} satisfies InstantRules

export default rules
