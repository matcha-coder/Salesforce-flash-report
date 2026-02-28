import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import executeQuery from '@salesforce/apex/FlashReportController.executeQuery';
import getSObjectNames from '@salesforce/apex/FlashReportController.getSObjectNames';
import getObjectDescribe from '@salesforce/apex/FlashReportController.getObjectDescribe';

export default class FlashReport extends LightningElement {
    @track queryInput = 'SELECT Id FROM Account LIMIT 200';
    @track exportedData = null;
    @track exportStatus = 'Ready';
    @track exportError = null;
    @track isWorking = false;
    @track resultsFilter = '';
    @track queryTabs = [];
    @track activeTabIndex = 0;

    // Query Builder Fields
    @track selectedObject = 'Account';
    @track selectedFields = ['Id', 'Name'];
    @track availableObjects = [];
    @track availableFields = [];
    @track limitValue = 200;
    @track whereClause = '';
    @track orderByField = '';
    @track isLoadingObjects = false;
    @track isLoadingFields = false;

    // Table data
    tableData = {
        records: [],
        table: [],
        rowVisibilities: [],
        colVisibilities: [],
        totalSize: 0
    };

    separator = ',';
    useToolingApi = false;
    queryAll = false;
    prefHideRelations = false;

    connectedCallback() {
        this.loadQueryTabs();
        this.loadObjects();
    }

    async loadObjects() {
        this.isLoadingObjects = true;
        try {
            const objectNames = await getSObjectNames();
            this.availableObjects = objectNames.map(name => ({
                label: name,
                value: name
            }));

            // Load fields for default object
            if (this.selectedObject) {
                await this.loadFields();
            }
        } catch (error) {
            this.showError('Error Loading Objects', error.body ? error.body.message : error.message);
        } finally {
            this.isLoadingObjects = false;
        }
    }

    async loadFields() {
        if (!this.selectedObject) return;

        this.isLoadingFields = true;
        try {
            const describe = await getObjectDescribe({ objectName: this.selectedObject });
            this.availableFields = describe.fields.map(field => ({
                label: `${field.label} (${field.name})`,
                value: field.name
            }));
        } catch (error) {
            this.showError('Error Loading Fields', error.body ? error.body.message : error.message);
        } finally {
            this.isLoadingFields = false;
        }
    }

    handleObjectChange(event) {
        this.selectedObject = event.detail.value;
        this.selectedFields = ['Id'];
        this.loadFields();
        this.buildQuery();
    }

    handleFieldsChange(event) {
        this.selectedFields = event.detail.value;
        this.buildQuery();
    }

    handleLimitChange(event) {
        this.limitValue = event.detail.value;
        this.buildQuery();
    }

    handleWhereChange(event) {
        this.whereClause = event.detail.value;
        this.buildQuery();
    }

    handleOrderByChange(event) {
        this.orderByField = event.detail.value;
        this.buildQuery();
    }

    buildQuery() {
        let query = 'SELECT ';

        // Add fields
        if (this.selectedFields && this.selectedFields.length > 0) {
            query += this.selectedFields.join(', ');
        } else {
            query += 'Id';
        }

        // Add object
        query += ` FROM ${this.selectedObject}`;

        // Add WHERE clause
        if (this.whereClause && this.whereClause.trim()) {
            query += ` WHERE ${this.whereClause.trim()}`;
        }

        // Add ORDER BY
        if (this.orderByField && this.orderByField.trim()) {
            query += ` ORDER BY ${this.orderByField.trim()}`;
        }

        // Add LIMIT
        if (this.limitValue) {
            query += ` LIMIT ${this.limitValue}`;
        }

        this.queryInput = query;

        // Update current tab
        if (this.queryTabs[this.activeTabIndex]) {
            this.queryTabs[this.activeTabIndex].query = query;
            this.saveQueryTabs();
        }
    }

    loadQueryTabs() {
        const savedTabs = sessionStorage.getItem('queryTabs');
        if (savedTabs) {
            this.queryTabs = JSON.parse(savedTabs);
        } else {
            this.queryTabs = [{
                name: 'Query 1',
                query: this.queryInput,
                results: null
            }];
        }
        this.activeTabIndex = 0;
    }

    saveQueryTabs() {
        sessionStorage.setItem('queryTabs', JSON.stringify(this.queryTabs));
    }

    handleAddTab() {
        const newTabName = `Query ${this.queryTabs.length + 1}`;
        this.queryTabs.push({
            name: newTabName,
            query: '',
            results: null
        });
        this.activeTabIndex = this.queryTabs.length - 1;
        this.queryInput = '';
        this.exportedData = null;
        this.saveQueryTabs();
    }

    handleRemoveTab(event) {
        event.stopPropagation();
        const index = parseInt(event.target.dataset.index);
        if (this.queryTabs.length > 1) {
            this.queryTabs.splice(index, 1);
            if (this.activeTabIndex >= index) {
                this.activeTabIndex = Math.max(0, this.activeTabIndex - 1);
            }
            this.setActiveTab(this.activeTabIndex);
            this.saveQueryTabs();
        }
    }

    handleTabClick(event) {
        const index = parseInt(event.currentTarget.dataset.index);
        this.setActiveTab(index);
    }

    setActiveTab(index) {
        this.activeTabIndex = index;
        const tab = this.queryTabs[index];
        this.queryInput = tab.query;
        this.exportedData = tab.results;

        if (this.exportedData && this.exportedData.records) {
            this.exportStatus = `Loaded ${this.exportedData.records.length} records`;
        } else {
            this.exportStatus = 'Ready';
        }
    }

    handleQueryChange(event) {
        this.queryInput = event.target.value;
        if (this.queryTabs[this.activeTabIndex]) {
            this.queryTabs[this.activeTabIndex].query = this.queryInput;
            this.saveQueryTabs();
        }
    }

    handleQueryAllChange(event) {
        this.queryAll = event.target.checked;
    }

    handleToolingApiChange(event) {
        this.useToolingApi = event.target.checked;
    }

    handlePrefHideRelationsChange() {
        this.prefHideRelations = !this.prefHideRelations;
        if (this.exportedData) {
            this.refreshColumnsVisibility();
        }
    }

    async handleExecuteQuery() {
        if (!this.queryInput || this.queryInput.trim() === '') {
            this.showError('Query Error', 'Please enter a query');
            return;
        }

        this.isWorking = true;
        this.exportStatus = 'Executing query...';
        this.exportError = null;

        try {
            const result = await executeQuery({
                query: this.queryInput.trim(),
                useToolingApi: this.useToolingApi
            });

            this.processQueryResults(result);

            // Store results in current tab
            if (this.queryTabs[this.activeTabIndex]) {
                this.queryTabs[this.activeTabIndex].results = this.exportedData;
                this.saveQueryTabs();
            }

        } catch (error) {
            this.exportError = error.body ? error.body.message : error.message;
            this.exportStatus = 'Error';
            this.showError('Query Execution Failed', this.exportError);
        } finally {
            this.isWorking = false;
        }
    }

    processQueryResults(result) {
        const records = result.records || [];
        this.tableData = this.createRecordTable(records);
        this.exportedData = this.tableData;
        this.exportStatus = `Exported ${records.length} record${records.length !== 1 ? 's' : ''}`;
        this.showSuccess(`Successfully retrieved ${records.length} record${records.length !== 1 ? 's' : ''}`);
    }

    createRecordTable(records) {
        const columnIdx = new Map();
        const header = ['_'];
        const table = [];
        const rowVisibilities = [];
        const colVisibilities = [true];

        if (records.length === 0) {
            return {
                records: [],
                table: [],
                rowVisibilities: [],
                colVisibilities: [],
                totalSize: 0
            };
        }

        // Add header row
        table.push(header);
        rowVisibilities.push(true);

        // Process each record
        for (let record of records) {
            const row = new Array(header.length);
            row[0] = record;
            table.push(row);
            rowVisibilities.push(true);
            this.discoverColumns(record, '', row, header, columnIdx, colVisibilities, table);
        }

        return {
            records: records,
            table: table,
            rowVisibilities: rowVisibilities,
            colVisibilities: colVisibilities,
            totalSize: records.length
        };
    }

    discoverColumns(record, prefix, row, header, columnIdx, colVisibilities, table) {
        for (let field in record) {
            if (field === 'attributes') continue;

            const column = prefix ? `${prefix}.${field}` : field;
            let c;

            if (columnIdx.has(column)) {
                c = columnIdx.get(column);
            } else {
                c = header.length;
                columnIdx.set(column, c);

                // Expand all existing rows
                for (let tableRow of table) {
                    tableRow.push(undefined);
                }

                header[c] = column;

                // Hide relationship columns if preference is set
                if (typeof record[field] === 'object' && record[field] !== null && this.prefHideRelations) {
                    colVisibilities.push(false);
                } else {
                    colVisibilities.push(true);
                }
            }

            row[c] = record[field];

            // Recurse for nested objects
            if (typeof record[field] === 'object' && record[field] !== null) {
                this.discoverColumns(record[field], column, row, header, columnIdx, colVisibilities, table);
            }
        }
    }

    refreshColumnsVisibility() {
        if (!this.exportedData || !this.exportedData.table || this.exportedData.table.length === 0) {
            return;
        }

        const newColVisibilities = [];
        for (let i = 0; i < this.exportedData.table[0].length; i++) {
            const cell = this.exportedData.table[1] ? this.exportedData.table[1][i] : null;
            if (typeof cell === 'object' && cell !== null && this.prefHideRelations) {
                newColVisibilities.push(false);
            } else {
                newColVisibilities.push(true);
            }
        }
        this.exportedData.colVisibilities = newColVisibilities;
        this.exportedData = {...this.exportedData}; // Trigger reactivity
    }

    handleResultsFilterInput(event) {
        this.resultsFilter = event.target.value;
        if (this.exportedData) {
            this.updateVisibility();
        }
    }

    updateVisibility() {
        if (!this.exportedData || !this.exportedData.table) return;

        const filter = this.resultsFilter.toLowerCase();
        let visibleCount = 0;

        for (let r = 1; r < this.exportedData.table.length; r++) {
            const row = this.exportedData.table[r];
            const isVisible = this.isRowVisible(row, filter);
            this.exportedData.rowVisibilities[r] = isVisible;
            if (isVisible) visibleCount++;
        }

        if (filter) {
            this.exportStatus = `Filtered ${visibleCount} records out of ${this.exportedData.records.length} records`;
        } else {
            this.exportStatus = `Exported ${this.exportedData.records.length} record${this.exportedData.records.length !== 1 ? 's' : ''}`;
        }

        this.exportedData = {...this.exportedData}; // Trigger reactivity
    }

    isRowVisible(row, filter) {
        if (!filter) return true;

        for (let cell of row) {
            if (cell !== null && cell !== undefined) {
                const cellStr = this.cellToString(cell).toLowerCase();
                if (cellStr.includes(filter)) {
                    return true;
                }
            }
        }
        return false;
    }

    cellToString(cell) {
        if (cell === null || cell === undefined) {
            return '';
        } else if (typeof cell === 'object' && cell.attributes && cell.attributes.type) {
            return `[${cell.attributes.type}]`;
        } else {
            return String(cell);
        }
    }

    // Export methods
    handleCopyAsCSV() {
        if (!this.canCopy()) return;
        const csv = this.csvSerialize(this.separator);
        this.copyToClipboard(csv);
        this.showSuccess('CSV copied to clipboard');
    }

    handleCopyAsExcel() {
        if (!this.canCopy()) return;
        const csv = this.csvSerialize('\t');
        this.copyToClipboard(csv);
        this.showSuccess('Excel data copied to clipboard');
    }

    handleCopyAsJSON() {
        if (!this.canCopy()) return;
        const json = JSON.stringify(this.exportedData.records, null, 2);
        this.copyToClipboard(json);
        this.showSuccess('JSON copied to clipboard');
    }

    handleDownloadCSV() {
        if (!this.canCopy()) return;
        const csv = this.csvSerialize(this.separator);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', `export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showSuccess('CSV file downloaded');
    }

    csvSerialize(separator) {
        const visibleTable = this.getVisibleTable();
        return visibleTable
            .map(row => row.map(cell => this.escapeCSV(cell)).join(separator))
            .join('\r\n');
    }

    getVisibleTable() {
        if (!this.exportedData || !this.exportedData.table) return [];

        let filteredTable = [];
        for (let i = 0; i < this.exportedData.table.length; i++) {
            if (this.exportedData.rowVisibilities[i]) {
                const row = this.exportedData.table[i];
                const filteredRow = row.filter((_, idx) => this.exportedData.colVisibilities[idx]);
                filteredTable.push(filteredRow);
            }
        }
        return filteredTable;
    }

    escapeCSV(cell) {
        const value = this.cellToString(cell);
        return '"' + value.replace(/"/g, '""') + '"';
    }

    copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    canCopy() {
        return this.exportedData && this.exportedData.records && this.exportedData.records.length > 0;
    }

    showSuccess(message) {
        this.dispatchEvent(new ShowToastEvent({
            title: 'Success',
            message: message,
            variant: 'success'
        }));
    }

    showError(title, message) {
        this.dispatchEvent(new ShowToastEvent({
            title: title,
            message: message,
            variant: 'error',
            mode: 'sticky'
        }));
    }

    // Getters for template
    get hasResults() {
        return this.exportedData && this.exportedData.records && this.exportedData.records.length > 0;
    }

    get hasError() {
        return this.exportError !== null;
    }

    get tableRows() {
        if (!this.hasResults) return [];

        const visibleTable = this.getVisibleTable();
        return visibleTable.slice(1).map((row, rowIndex) => ({
            id: `row-${rowIndex}`,
            cells: row.map((cell, cellIndex) => ({
                id: `row-${rowIndex}-cell-${cellIndex}`,
                value: this.cellToString(cell)
            }))
        }));
    }

    get tableHeaders() {
        if (!this.hasResults) return [];

        const visibleTable = this.getVisibleTable();
        const headers = visibleTable[0] || [];
        return headers.map((header, index) => ({
            id: `header-${index}`,
            value: this.cellToString(header)
        }));
    }

    get tabs() {
        return this.queryTabs.map((tab, index) => ({
            ...tab,
            index: index,
            isActive: index === this.activeTabIndex
        }));
    }

    get buttonsDisabled() {
        return !this.canCopy();
    }

    get prefHideRelationsTitle() {
        return this.prefHideRelations ? 'Show Object Columns' : 'Hide Object Columns';
    }

    get hideIconVariant() {
        return this.prefHideRelations ? 'brand' : 'neutral';
    }

    get statusBadgeClass() {
        return this.hasError ? 'slds-badge slds-theme_error' : 'slds-badge slds-theme_success';
    }
}