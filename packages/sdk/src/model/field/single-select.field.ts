import { SingleSelectFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';
import { SelectFieldSdk } from './mixin/select.field';

export class SingleSelectField extends Mixin(SelectFieldSdk, SingleSelectFieldCore, Field) {}
