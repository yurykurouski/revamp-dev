import { Request, Response, NextFunction } from 'express';
import { ReverseGeocodeQuery } from '@revamp/validation';
import { DiscoveryService } from '../services/discovery.service.js';

export const startDiscovery = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await DiscoveryService.startDiscovery(req.body);
    res.status(202).json({
      success: true,
      message: 'Discovery job queued successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getDiscoveryStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await DiscoveryService.getDiscoveryStatus(req.params['jobId'] as string);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const reverseGeocode = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await DiscoveryService.reverseGeocode(req.query as unknown as ReverseGeocodeQuery);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
