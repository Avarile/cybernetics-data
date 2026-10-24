import { ColorUtils, SelectFieldCore } from '@cybernetics/core';
import { keyBy } from 'lodash';
import colors from 'tailwindcss/colors';

export interface ISelectFieldDisplayChoice {
  id: string;
  name: string;
  color: string;
  backgroundColor: string;
  /** Stored `Colors` value; the grid derives theme-aware tag colours from it (design D4). */
  colorName: string;
}

export abstract class SelectFieldSdk extends SelectFieldCore {
  private _choiceMap: Record<string, ISelectFieldDisplayChoice> = {};
  private _choiceMapKey = '';

  get displayChoiceMap() {
    const choices = this.options?.choices ?? [];
    const choicesKey = JSON.stringify(choices.map(({ id, name, color }) => [id, name, color]));
    if (this._choiceMapKey !== choicesKey) {
      const displayedChoices = choices.map(({ id, name, color }) => {
        return {
          id,
          name,
          color: ColorUtils.shouldUseLightTextOnColor(color) ? colors.white : colors.black,
          backgroundColor: ColorUtils.getHexForColor(color),
          colorName: color,
        };
      });
      this._choiceMap = keyBy(displayedChoices, 'name');
      this._choiceMapKey = choicesKey;
    }
    return this._choiceMap;
  }
}
