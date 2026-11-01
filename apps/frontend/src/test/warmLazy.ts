// Landningen och touren är lazy-chunkar (routes.tsx, App.tsx). Den första dynamiska importen i en testfil är kall och kan ta längre än
// findBy/waitFor-sekunden när sviten körs parallellt, så filer som renderar dem värmer modulerna i en beforeAll.
export const warmLanding = async (): Promise<void> => {
  await import('@/pages/Index');
};

// Profil-popupen (RunnerPopup) är en lazy chunk: proven som väntar på den riktiga dialogen värmer den i en beforeAll.
export const warmRunnerPopup = async (): Promise<void> => {
  await import('@/features/runner/components/RunnerPopup');
};

export const warmOnboarding = async (): Promise<void> => {
  await import('@/features/onboarding/components/OnboardingOrchestrator');
};

// Sidorna utanför huvudskalet (preview, legal, admin, playbook, features, settings) är lazy-chunkar i routes.tsx: rutt-testerna värmer dem
// i en beforeAll i stället för att höja timeouts.
export const warmLazyPages = async (): Promise<void> => {
  await Promise.all([
    import('@/pages/LeaderboardPreviewPage'),
    import('@/pages/ChallengesPreviewPage'),
    import('@/pages/BadgesPreviewPage'),
    import('@/pages/LegalPage'),
    import('@/pages/AdminPage'),
    import('@/pages/PlaybookPage'),
    import('@/pages/FeaturesPage'),
    import('@/pages/SettingsPage'),
  ]);
};
