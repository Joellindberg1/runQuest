/** Names of the Strava credentials that are missing. Without them every expired token would look like "must reconnect". */
export function missingStravaCredentials(env: NodeJS.ProcessEnv): string[] {
  return ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'].filter((name) => !env[name]);
}
