import { LinkFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class LinkField extends Mixin(LinkFieldCore, Field) {}
