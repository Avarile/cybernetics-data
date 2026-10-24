import { RollupFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class RollupField extends Mixin(RollupFieldCore, Field) {}
