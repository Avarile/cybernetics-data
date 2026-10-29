# Goal: Update the Agent Component

Feature - 1: The Agent Component is forced to be a full screen component, it can only be toggled on and off.
Feature - 2: Completely redesign according to: /home/avarile/Documents/agentic-centre/ai-cockpit/ follow as much as you can 
  1. Keep the existing voice related feature
  2. When answering a question, follow the given logic:
     1. Identify user intention, if not clear, ask the user.
     2. According to the question, make a data search plan, for example, user ask about Project Progress, then Goal, Project, tasks related to the project, people related to this project and tasks, or any other related info. So the search can be:
       First step: Search for this project in "projects" table.
       Second step: Search for any tasks related to this project in "tasks" table.
       Third step: Search for any contacts in "contacts" table linked to each task and project.
       Fourth step: Search for any knowledge in "knowledges" table linked to each task and project(if available)
     3. During the search of each table, the UI needs to show respective table. For each records hit in the query, they will be shown in a card, each new record will be a new card on each other.
Feature - 3: A moduled, layer code system design.

the output expected is a comprehensive design including the frontend and the backend
All of the frontend components including the state management should be in the same folder.
output the design to `scripts/customized/developments/current-design.md`
