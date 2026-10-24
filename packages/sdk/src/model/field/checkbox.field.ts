import { CheckboxFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class CheckboxField extends Mixin(CheckboxFieldCore, Field) {}
