/* istanbul ignore file */

import { Serenity } from '@serenity-js/core';
import { DomainEvent, SceneFinished, SceneFinishes, SceneStarts, SceneTagged, TestRunFinished, TestRunFinishes, TestRunnerDetected } from '@serenity-js/core/lib/events';
import { ArbitraryTag, ExecutionRetriedTag, FeatureTag, Name } from '@serenity-js/core/lib/model';
import { MochaOptions, reporters, Runner, Test } from 'mocha';
import { MochaOutcomeMapper, MochaTestMapper } from './mappers';
import { OutcomeRecorder } from './OutcomeRecorder';

/**
 * @package
 */
export class SerenityReporterForMocha extends reporters.Base {

    private readonly testMapper: MochaTestMapper = new MochaTestMapper();
    private readonly outcomeMapper: MochaOutcomeMapper = new MochaOutcomeMapper();

    private readonly recorder: OutcomeRecorder = new OutcomeRecorder();

    /**
     * @param {Serenity} serenity
     * @param {mocha~Runner} runner
     * @param {mocha~MochaOptions} options
     */
    constructor(private readonly serenity: Serenity,
                runner: Runner,
                options?: MochaOptions,
    ) {
        super(runner, options);

        runner.on(Runner.constants.EVENT_TEST_BEGIN,
            (test: Test) => {
                this.recorder.started(test);

                this.announceSceneStartsFor(test);
            },
        );

        runner.on(Runner.constants.EVENT_TEST_PASS,
            (test: Test) => {
                this.announceRetryIfNeeded(test);

                this.recorder.finished(!! test.ctx ? test.ctx.currentTest : test, this.outcomeMapper.outcomeOf(test))
            },
        );

        runner.on(Runner.constants.EVENT_TEST_FAIL,
            (test: Test, err: Error) => {
                this.announceRetryIfNeeded(test);

                this.recorder.finished(!! test.ctx ? test.ctx.currentTest : test, this.outcomeMapper.outcomeOf(test, err))
            },
        );

        runner.on(Runner.constants.EVENT_TEST_RETRY,
            (test: Test, err: Error) => {
                this.announceRetryIfNeeded(test);

                this.recorder.finished(
                    !! test.ctx && test.ctx.currentTest ? test.ctx.currentTest : test,
                    this.outcomeMapper.outcomeOf(test, err),
                );
            },
        );

        const announceSceneFinishedFor = this.announceSceneFinishedFor.bind(this);

        runner.suite.afterEach('Serenity/JS', function () {
            return announceSceneFinishedFor(this.currentTest);
        });

        // https://github.com/cypress-io/cypress/issues/7562
        runner.on('test:after:run', (test: Test) => {
            return announceSceneFinishedFor(test);
        });

        // Tests without body don't trigger the above custom afterEach hook
        runner.on(Runner.constants.EVENT_TEST_PENDING,
            (test: Test) => {
                if (! test.fn) {
                    this.announceSceneSkippedFor(test);
                }
            },
        );
    }

    public done(failures: number, fn?: (failures: number) => void): void {
        this.emit(new TestRunFinishes(this.serenity.currentTime()));

        this.serenity.waitForNextCue()
            .then(() => this.emit(new TestRunFinished(this.serenity.currentTime())))
            .then(() => fn(failures));
    }

    private announceSceneStartsFor(test: Test): void {
        const scenario = this.testMapper.detailsOf(test);

        this.emit(
            new SceneStarts(
                scenario,
                this.serenity.currentTime(),
            ),
            new SceneTagged(
                scenario,
                new FeatureTag(this.testMapper.featureNameFor(test)),
                this.serenity.currentTime(),
            ),
            new TestRunnerDetected(
                new Name('Mocha'),
                this.serenity.currentTime(),
            ),
        );
    }

    private announceSceneFinishedFor(test: Test): Promise<void> {
        const scenario = this.testMapper.detailsOf(test);

        this.emit(
            new SceneFinishes(
                scenario,
                this.serenity.currentTime(),
            ),
        );

        return this.serenity.waitForNextCue()
            .then(() => {
                this.emit(new SceneFinished(
                    scenario,
                    this.recorder.outcomeOf(test) || this.outcomeMapper.outcomeOf(test),
                    this.serenity.currentTime(),
                ));

                this.recorder.erase(test);
            });
    }

    private announceSceneSkippedFor(test: Test): void {
        const scenario = this.testMapper.detailsOf(test)

        this.announceSceneStartsFor(test);

        this.emit(
            new SceneFinishes(
                scenario,
                this.serenity.currentTime(),
            ),
            new SceneFinished(
                scenario,
                this.outcomeMapper.outcomeOf(test),
                this.serenity.currentTime(),
            )
        );
    }

    private announceRetryIfNeeded(test: Test): void {
        if (! this.isRetriable(test)) {
            return void 0;
        }

        const scenario = this.testMapper.detailsOf(test)

        this.emit(
            new SceneTagged(
                scenario,
                new ArbitraryTag('retried'),
                this.serenity.currentTime(),
            ),
        );

        if (this.currentRetryOf(test) > 0) {
            this.emit(
                new SceneTagged(
                    scenario,
                    new ExecutionRetriedTag(this.currentRetryOf(test)),
                    this.serenity.currentTime(),
                ),
            );
        }
    }

    private isRetriable(test: Test): boolean {
        return (test as any).retries() >= 0;
    }

    private currentRetryOf(test: Test): number {
        return (test as any).currentRetry();
    }

    private emit(...events: DomainEvent[]): void {
        events.forEach(event => this.serenity.announce(event));
    }
}
