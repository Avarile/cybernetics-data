# Goal: Update the Agent Cockpit component

Feature - 1: Move the Component of "OVERVIEW BOARD CONSTELLATION BUNDLE TREE" from the current position to the left side of the screen, under the "Overview Component", stack all of the button on each other. Remove the button of OVERVIEW BOARD CONSTELLATION. Also completely remove the BOARD components.
Feature - 2: Completely update the "ASK THE AGENT", "TYPES" and "RECENTLY UPDATED" Panel:
  - "ASK THE AGENT": 
    a. Remove all of the suggested options. like "How is my latest project going?", "Which tasks are in progress, and who is on them?"... 
    b. Add 2 "/commands" and remove all other existing commands:
      command - 1: "/base <basename>" use for select the current database, take the local dev server for exmample, there are 3 databases: "data-centre", "demo_database", "primary_database_2", so when I type "/base", all 3 of those databases will be suggested, and if I continue to type "/base dat", the suggestion should only be "data-centre", basically an autocomplete user experience.
      command - 2: "/table <tablename>" use for select the current table/schema, take the "data-centre" database in local dev server for example, it has lots of tables in it, this command will work like an autocomplete as well.
      command - 3: if no other commands are entered, user's direct input means query the string, the query will be triggered in 2 ways, first is 3 second idle(the string is not empty, and idle longer than 3 seconds), second is user push enter or click the send button. The query will be a normal search identical to the "Search" function in the "table" page. If there are results / result, all results will be highlighted in the constellation graph and also shows as items in the new "Search Results" panel. Clicking on each item in the new "Search Results" panel will 1. highlight it in the in the constellation graph(if the result item does not included in the contellation graph due to the max item limitation, then add those results into the constellation, and remove some of the items not the result, limit the max amount of the result items to 10). 2. Open the center modal to present the record raw context in MD format. if the context of this record is more than 500 Chars, then summarize with the agent and if the voice is enabled, the AI voice will read the summery out.
  - "TYPES": No difference from it is currently.
  - "RECENTLY UPDATED": This component will be replaced by "Search Results" panel, the context of the "Search Results" will be items of the search results, details already explained before.
Feature - 3: The "THREAD" dropdown component will be replaced by the current selected Base, it will update according to the selected Database. Also add a new icon to set a base to default(so that all tables in this base can be used as default tables rotate every 60 seconds).

the output expected is a comprehensive design including the frontend and the backend
All of the frontend components including the state management should be in the same folder.
output the design to `scripts/customized/developments/current-design.md`
