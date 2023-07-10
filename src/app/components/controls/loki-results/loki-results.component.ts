import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    Input,
    OnInit,
    Output,
    ViewEncapsulation
} from '@angular/core';
import { Functions, log } from '@app/helpers/functions';
import { PreferenceAdvancedService, SearchRemoteService, SearchService } from '@app/services';
import { DateTimeRangeService } from '@app/services/data-time-range.service';
import { ModulesService } from '@app/services/modules.service';

@Component({
    selector: 'app-loki-results',
    templateUrl: './loki-results.component.html',
    styleUrls: ['./loki-results.component.scss'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LokiResultsComponent implements OnInit, AfterViewInit {
    @Input() id;
    @Input() dataItem: any;
    @Input() isDisplayResult = false;
    @Input() isResultPage = false;

    _logQlText = '';
    @Input() set logQlText(val) {
        this._logQlText = val;
        this.getLabels();
        this.isFirstSearch = true;
    }

    @Input() customTimeRangeQuery: any | null = null;

    get logQlText() {
        return this._logQlText;
    }

    queryText: string;
    queryObject: any;
    rxText: string;
    showTime = true;
    showTags = false;
    showTs = false;
    showLabels = true;
    queryStatsNum = [];
    queryStatsText;
    checked: boolean;
    resultData: Array<any> = [];
    isFirstSearch = true;
    labels: Array<any> = [];
    lokiLabels;
    lokiTemplate;
    loading = false;
    resultsFound = true;
    dataError = false;
    @Output() ready: EventEmitter<any> = new EventEmitter();
    constructor(
        private _pas: PreferenceAdvancedService,
        private _srs: SearchRemoteService,
        private _dtrs: DateTimeRangeService,
        private searchService: SearchService,
        private modules: ModulesService,
        private cdr: ChangeDetectorRef

    ) { }

    ngOnInit() {
        this.customTimeRangeQuery ||= this._dtrs.getDatesForQuery(true);
        this.getLabels();
    }
    ngAfterViewInit() {
        window.requestAnimationFrame(() => {
            this.ready.emit({});
            this.doSerchResult();
        });
    }

    getLabels() {
        if (this.isDisplayResult) {
            this.queryText = this.logQlText || '{type="call"}';
            return;
        }

        this.lokiTemplate = {
            lineFilterOperator: '|~',
            logStreamSelector: '{job="heplify-server"}',
            labelField: 'callid'
        };
        this.modules.getModules().then(({ data: { loki } }) => {
            let labels = '';
            if (loki.template) {

                const matchOperator = loki.template.match(/\|=|\|~|!=|!~/);
                if (matchOperator && matchOperator[0]) {
                    this.lokiTemplate.lineFilterOperator = matchOperator[0];
                    loki.template = loki.template.replace(matchOperator[0], '')
                }
                const matchLabel = loki.template.match(/\s*"\%(.*)\%"/)
                if (matchLabel && matchLabel[1]) {
                    this.lokiTemplate.labelField = matchLabel[1];
                    loki.template = loki.template.replace(matchLabel[0], '')
                }
                this.lokiTemplate.logStreamSelector = loki.template;
            }
            if (this.lokiTemplate.labelField === 'callid') {
                labels = this.getCallidLabels();
            } else {
                labels = this.getGenericLabels();
                if (labels === '') {
                    labels = this.getCallidLabels();
                }
            }
            if (typeof this.lokiTemplate !== 'undefined') {
                this.queryText = `${this.lokiTemplate.logStreamSelector} ${this.lokiTemplate.lineFilterOperator} "${labels}"`;
                this.cdr.detectChanges();
            }
        });
        this.cdr.detectChanges();
    }
    getCallidLabels(): string {
        const labels = this.dataItem.data.callid
            .reduce((a, b) => {
                if (a.indexOf(b) === -1) {
                    a.push(b);
                }
                return a;
            }, [])
            .join('|');
        return labels;
    }
    getGenericLabels(): string {
        let labels = [];
        this.dataItem.data.messages.forEach(message => {
            console.log(message, message?.[this.lokiTemplate.labelField], this.lokiTemplate.labelField)
            const value = message?.[this.lokiTemplate.labelField];
            if (typeof value !== 'undefined') {
                labels.push(value);
            }
        });
        labels = Functions.arrayUniques(labels)
        return labels.join('|');
    }
    queryBuilder() {
        /** depricated, need use {SearchService} */

        return {
            param: {
                server: this.queryObject.serverLoki, // 'http://127.0.0.1:3100',
                limit: this.queryObject.limit * 1,
                search: this.queryObject.text,
                timezone: this.searchService.getTimeZoneLocal(),
            },
            timestamp: this._dtrs.getDatesForQuery(true),
        };
    }

    async doSerchResult() {  // here add loading when hit button
        this.queryStatsText = '';
        this.queryStatsNum = [];
        this.rxText = this.queryObject.rxText;
        this.isFirstSearch = false;
        this.loading = true;

        await this._srs.getData(this.queryBuilder()).toPromise().then(res => {

            this.resultData = res && res.data ? (res.data as Array<any>) : [];

            if (this.resultData.length > 0) {
                this.loading = false;
                this.lokiLabels = this.resultData.map((l) => {
                    l.custom_2 = this.labelsFormatter(l.custom_2);
                    return l;
                });
                this.resultData = this.resultData.map((i) => {
                    i.custom_1 = this.highlight(i.custom_1);
                    return i;
                });

                this.resultsFound = true;

            } else {
                this.loading = false;
                this.resultsFound = false;
            }

        })
        this.loading = false;
        this.cdr.detectChanges();
    }
    onUpdateData(event) {
        this.queryObject = event;
        this.queryObject.limit = 100;
        if (this.isDisplayResult && this.isFirstSearch) {
            this.doSerchResult();
        }
        this.cdr.detectChanges();
    }

    private labelsFormatter(rd) {
        const lokiLabels = Functions.JSON_parse(rd);
        return lokiLabels;
    }

    identify(index, item) {
        return item.micro_ts;
    }

    private highlight(value: string = '') {
        let data;
        if (!!this.rxText) {
            const rxText = this.rxText.replace(/\s|(\|=|\|~|!=|!~)|("|`)/g, '')
                .split('|').sort((a, b) => b.length - a.length).join('|');
            const regex = new RegExp('(' + rxText + ')', 'g');
            data = value
                .replace(/\</g, '&lt;')
                .replace(/\>/g, '&gt;')
                .replace(regex, (g, a) => {
                    return `<span>${a}</span>`;
                });
        } else {
            data = value || '';
        }
        return data;
    }
    showLabel(idx) {
        let tag = document.getElementById('label-' + idx)
        let icon = document.getElementById('icon-' + idx)
        if (tag.style.display === 'none') {
            tag.style.cssText = `
            display:flex;
            flex-direction:column;
            `;
            icon.innerText = 'keyboard_arrow_down'

        } else {
            tag.style.display = 'none'
            icon.innerText = 'navigate_next'
        }
    }
}
