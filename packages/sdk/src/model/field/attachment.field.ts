import { AttachmentFieldCore } from '@cybernetics/core';
import { Mixin } from 'ts-mixer';
import { Field } from './field';

export class AttachmentField extends Mixin(AttachmentFieldCore, Field) {}
