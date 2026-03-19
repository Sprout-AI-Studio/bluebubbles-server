import React, { useEffect, useState } from 'react';
import {
    FormControl,
    FormLabel,
    FormHelperText,
    Input,
    IconButton,
    FormErrorMessage,
    Text
} from '@chakra-ui/react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import { showSuccessToast } from '../../utils/ToastUtils';
import { setConfig } from '../../slices/ConfigSlice';
import { AiOutlineSave } from 'react-icons/ai';

export const SlackWebhookUrlField = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const webhookUrl: string = (useAppSelector(state => state.config.slack_webhook_url) ?? '');
    const [newUrl, setNewUrl] = useState(webhookUrl);
    const [error, setError] = useState('');
    const hasError: boolean = (error ?? '').length > 0;

    useEffect(() => { setNewUrl(webhookUrl); }, [webhookUrl]);

    const saveUrl = (url: string): void => {
        url = url.trim();
        if (url === webhookUrl) {
            setError('You have not changed the URL since your last save!');
            return;
        }

        dispatch(setConfig({ name: 'slack_webhook_url', value: url }));
        setError('');
        showSuccessToast({
            id: 'settings',
            duration: 4000,
            description: 'Successfully saved Slack Webhook URL!'
        });
    };

    return (
        <FormControl isInvalid={hasError}>
            <FormLabel htmlFor='slack_webhook_url'>Slack Webhook URL</FormLabel>
            <Input
                id='slack_webhook_url'
                type='text'
                maxWidth="30em"
                placeholder='https://hooks.slack.com/services/...'
                value={newUrl}
                onChange={(e) => {
                    if (hasError) setError('');
                    setNewUrl(e.target.value);
                }}
            />
            <IconButton
                ml={3}
                verticalAlign='top'
                aria-label='Save Slack webhook URL'
                icon={<AiOutlineSave />}
                onClick={() => saveUrl(newUrl)}
            />
            {!hasError ? (
                <FormHelperText>
                    <Text>
                        The Slack Incoming Webhook URL to send alerts to.
                        Create one in your Slack workspace's app settings.
                    </Text>
                </FormHelperText>
            ) : (
                <FormErrorMessage>{error}</FormErrorMessage>
            )}
        </FormControl>
    );
};
