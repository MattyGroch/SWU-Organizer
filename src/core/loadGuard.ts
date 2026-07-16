export type LoadToken = number

export type LoadCommitGate = {
  begin: () => LoadToken
  canCommit: (token: LoadToken) => boolean
  cancel: (token: LoadToken) => void
}

export function createLoadCommitGate(): LoadCommitGate {
  let latest = 0

  return {
    begin() {
      latest += 1
      return latest
    },
    canCommit(token) {
      return token === latest
    },
    cancel(token) {
      if (token === latest) latest += 1
    },
  }
}
