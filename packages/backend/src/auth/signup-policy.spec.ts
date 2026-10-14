import {
  decideUserCreation,
  FIRST_USER_VIA_SETUP_MESSAGE,
  isServerUserCreation,
  isSignupValveOpen,
  runAsServerUserCreation,
  SIGNUP_CLOSED_MESSAGE,
} from './signup-policy';

describe('signup policy', () => {
  const hasUsers = jest.fn<Promise<boolean>, []>();

  beforeEach(() => hasUsers.mockReset());

  it('reads the valve only when it is exactly "true"', () => {
    expect(isSignupValveOpen({})).toBe(false);
    expect(isSignupValveOpen({ THINKER_ALLOW_SIGNUP: 'false' })).toBe(false);
    expect(isSignupValveOpen({ THINKER_ALLOW_SIGNUP: '1' })).toBe(false);
    expect(isSignupValveOpen({ THINKER_ALLOW_SIGNUP: 'true' })).toBe(true);
  });

  it('refuses public sign-up by default without querying the database', async () => {
    await expect(decideUserCreation(hasUsers, {})).resolves.toEqual({
      allowed: false,
      message: SIGNUP_CLOSED_MESSAGE,
    });
    expect(hasUsers).not.toHaveBeenCalled();
  });

  it('refuses the first account outside the setup wizard, even with the valve open', async () => {
    hasUsers.mockResolvedValue(false);
    await expect(decideUserCreation(hasUsers, { THINKER_ALLOW_SIGNUP: 'true' })).resolves.toEqual({
      allowed: false,
      message: FIRST_USER_VIA_SETUP_MESSAGE,
    });
  });

  it('allows further accounts once an admin exists and the valve is open', async () => {
    hasUsers.mockResolvedValue(true);
    await expect(decideUserCreation(hasUsers, { THINKER_ALLOW_SIGNUP: 'true' })).resolves.toEqual({
      allowed: true,
    });
  });

  it('allows trusted server-side creation regardless of the valve', async () => {
    expect(isServerUserCreation()).toBe(false);
    const decision = await runAsServerUserCreation(() => decideUserCreation(hasUsers, {}));
    expect(decision).toEqual({ allowed: true });
    expect(hasUsers).not.toHaveBeenCalled();
    expect(isServerUserCreation()).toBe(false);
  });

  it('keeps the trusted mark across awaits inside the callback only', async () => {
    const seen: boolean[] = [];
    await runAsServerUserCreation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(isServerUserCreation());
    });
    seen.push(isServerUserCreation());
    expect(seen).toEqual([true, false]);
  });
});
