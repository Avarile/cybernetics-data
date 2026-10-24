import { UserFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class UserField extends Mixin(UserFieldCore, Field) {}
