import {
  hasAllOf,
  hasAnyOf,
  hasNoneOf,
  isExactly,
  isNotExactly,
  isNoneOf,
  isAnyOf,
  isEmpty,
  isNotEmpty,
} from '@teable/core';

const EMPTY_OPERATORS = [isEmpty.value, isNotEmpty.value] as string[];
const SINGLE_SELECT_ARRAY_OPERATORS = [isAnyOf.value, isNoneOf.value] as string[];
const MULTIPLE_SELECT_ARRAY_OPERATORS = [
  hasAnyOf.value,
  hasAllOf.value,
  hasNoneOf.value,
  isExactly.value,
  isNotExactly.value,
] as string[];
const ARRAY_OPERATORS = [...SINGLE_SELECT_ARRAY_OPERATORS, ...MULTIPLE_SELECT_ARRAY_OPERATORS];

export { EMPTY_OPERATORS, ARRAY_OPERATORS };
