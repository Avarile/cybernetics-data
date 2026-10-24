import { SingleLineTextFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class SingleLineTextField extends Mixin(SingleLineTextFieldCore, Field) {}
