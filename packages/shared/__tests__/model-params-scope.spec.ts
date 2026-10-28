import {
  modelParamsScopeForTier,
  modelParamsScopeForSpecificity,
  modelParamsScopeForRouting,
  modelParamsScopeForVirtualModel,
} from '../src/model-params-scope';

describe('modelParamsScopeForVirtualModel', () => {
  it('prefixes the virtual model id', () => {
    expect(modelParamsScopeForVirtualModel('vm-1')).toBe('virtual:vm-1');
  });
});

describe('modelParamsScopeForTier', () => {
  it('prefixes the tier', () => {
    expect(modelParamsScopeForTier('complex')).toBe('tier:complex');
  });
});

describe('modelParamsScopeForSpecificity', () => {
  it('prefixes the specificity category', () => {
    expect(modelParamsScopeForSpecificity('coding')).toBe('specificity:coding');
  });
});

describe('modelParamsScopeForRouting', () => {
  it('uses specificity when present', () => {
    expect(
      modelParamsScopeForRouting({
        tier: 'standard',
        specificityCategory: 'trading',
      }),
    ).toBe('specificity:trading');
  });

  it('falls back to the complexity tier when no specificity is set', () => {
    expect(modelParamsScopeForRouting({ tier: 'simple' })).toBe('tier:simple');
  });
});
