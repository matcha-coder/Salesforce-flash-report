public with sharing class FlashReportController {

    public class QueryResult {
        @AuraEnabled public List<SObject> records;
        @AuraEnabled public Integer totalSize;
        @AuraEnabled public Boolean done;
        @AuraEnabled public String queryLocator;
    }

    public class FieldInfo {
        @AuraEnabled public String name;
        @AuraEnabled public String label;
        @AuraEnabled public String dataType;
        @AuraEnabled public String relationshipName;
    }

    public class DescribeResult {
        @AuraEnabled public String name;
        @AuraEnabled public String label;
        @AuraEnabled public List<FieldInfo> fields;

        public DescribeResult() {
            this.fields = new List<FieldInfo>();
        }
    }

    /**
     * Execute a SOQL query and return results
     */
    @AuraEnabled
    public static QueryResult executeQuery(String query, Boolean useToolingApi) {
        try {
            if (String.isBlank(query)) {
                throw new AuraHandledException('Query cannot be empty');
            }

            QueryResult result = new QueryResult();

            // For now, we'll handle standard SOQL only
            // Tooling API would require HTTP callout
            if (useToolingApi) {
                throw new AuraHandledException('Tooling API queries require additional setup. Use standard SOQL for now.');
            }

            // Execute the query
            List<SObject> records = Database.query(query);

            result.records = records;
            result.totalSize = records.size();
            result.done = true;

            return result;

        } catch (QueryException e) {
            throw new AuraHandledException('Query Error: ' + e.getMessage());
        } catch (Exception e) {
            throw new AuraHandledException('Unexpected Error: ' + e.getMessage());
        }
    }

    /**
     * Get list of all queryable SObjects
     */
    @AuraEnabled(cacheable=true)
    public static List<String> getSObjectNames() {
        List<String> objectNames = new List<String>();

        for (Schema.SObjectType objType : Schema.getGlobalDescribe().values()) {
            Schema.DescribeSObjectResult describe = objType.getDescribe();
            if (describe.isQueryable() && describe.isAccessible()) {
                objectNames.add(describe.getName());
            }
        }

        objectNames.sort();
        return objectNames;
    }

    /**
     * Get metadata for a specific SObject
     */
    @AuraEnabled(cacheable=true)
    public static DescribeResult getObjectDescribe(String objectName) {
        try {
            Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectName);
            if (objType == null) {
                throw new AuraHandledException('Object not found: ' + objectName);
            }

            Schema.DescribeSObjectResult describe = objType.getDescribe();

            // Check if user has access
            if (!describe.isAccessible()) {
                throw new AuraHandledException('You do not have access to this object');
            }

            DescribeResult result = new DescribeResult();
            result.name = describe.getName();
            result.label = describe.getLabel();

            // Get all fields
            for (Schema.SObjectField field : describe.fields.getMap().values()) {
                Schema.DescribeFieldResult fieldDescribe = field.getDescribe();

                // Only include accessible fields
                if (fieldDescribe.isAccessible()) {
                    FieldInfo fieldInfo = new FieldInfo();
                    fieldInfo.name = fieldDescribe.getName();
                    fieldInfo.label = fieldDescribe.getLabel();
                    fieldInfo.dataType = String.valueOf(fieldDescribe.getType());
                    fieldInfo.relationshipName = fieldDescribe.getRelationshipName();
                    result.fields.add(fieldInfo);
                }
            }

            return result;

        } catch (Exception e) {
            throw new AuraHandledException('Error describing object: ' + e.getMessage());
        }
    }

    /**
     * Get picklist values for a field
     */
    @AuraEnabled(cacheable=true)
    public static List<String> getPicklistValues(String objectName, String fieldName) {
        List<String> picklistValues = new List<String>();

        try {
            Schema.SObjectType objType = Schema.getGlobalDescribe().get(objectName);
            if (objType == null) {
                return picklistValues;
            }

            Schema.DescribeSObjectResult describe = objType.getDescribe();
            Schema.SObjectField field = describe.fields.getMap().get(fieldName);

            if (field != null) {
                Schema.DescribeFieldResult fieldDescribe = field.getDescribe();
                List<Schema.PicklistEntry> entries = fieldDescribe.getPicklistValues();

                for (Schema.PicklistEntry entry : entries) {
                    if (entry.isActive()) {
                        picklistValues.add(entry.getValue());
                    }
                }
            }

        } catch (Exception e) {
            System.debug('Error getting picklist values: ' + e.getMessage());
        }

        return picklistValues;
    }
}