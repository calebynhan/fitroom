import { describe, expect, it } from 'vitest';
import { outcomeOf } from './analytics';
import { cancelledError, describeSpaceError, SpaceError } from './tryon/space';

describe('outcomeOf', () => {
  it('buckets the messages the shopper sees', () => {
    expect(outcomeOf(describeSpaceError('You have exceeded your ZeroGPU runs limit'))).toBe('quota');
    expect(outcomeOf(describeSpaceError('This application is currently busy. Please try again.'))).toBe('busy');
    expect(outcomeOf(describeSpaceError('Space metadata could not be loaded'))).toBe('unreachable');
    expect(outcomeOf(describeSpaceError('Please upload a person image'))).toBe('photo');
    expect(outcomeOf(describeSpaceError('something odd'))).toBe('photo');
    expect(outcomeOf(cancelledError())).toBe('cancelled');
    expect(outcomeOf(new SpaceError('The free try-on is taking too long (busy or stuck). Try again in a minute.', true))).toBe('timeout');
    expect(outcomeOf(new SpaceError("Couldn't load the product photo. Try again.", true))).toBe('unreachable');
    expect(outcomeOf(new SpaceError('Something went wrong with the try-on. Try again.', true))).toBe('error');
  });
});
